pragma Singleton
// The one audio capture every Lock Ring shares, on every monitor, so they all pulse in sync.
// A singleton (listed in qmldir, which is what makes it one instance across DMS's per-screen
// loads) around the shared AudioPipeline. cava runs only while a ring holds it: each ring joins on
// creation (lock) and leaves on destruction (unlock). With no ring left the pipeline is destroyed,
// so nothing captures while unlocked and the next lock starts from silence.
//
//   Component.onCompleted: LockAudio.join(ring)
//   Component.onDestruction: LockAudio.leave(ring)
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Common
import "audio"
import "share.mjs" as Share
import "pace.mjs" as Pace
import "ring.mjs" as Ring
import "kicks.mjs" as Kicks
import "hands.mjs" as Hands
import "clock.mjs" as Clock
import "docs/kick.mjs" as Kick
import "docs/config.mjs" as Config

Singleton {
    id: root

    // --- Inputs -----------------------------------------------------------
    // Every setting from the Bar Visualizer's config.json (docs/config.mjs): the bar's, which the
    // Lock Ring shares, and its own in the lockRing section. One file for both, tuned in one place
    // (ADR 0004). Its defaults while there is none; the Lock Ring never writes it. Watched, so an
    // edit applies by the next lock.
    property var settings: Config.DEFAULTS
    // The settings the Lock Ring runs on: the bar's, with the lockRing section's percentages of
    // intensity and the kick settings applied (ADR 0005).
    readonly property var ringSettings: Config.lockRingSettings(settings)

    // --- Outputs ----------------------------------------------------------
    // The look settings, the same for every ring.
    readonly property real intensity: ringSettings.intensity
    readonly property real bassStretch: settings.bassStretch
    readonly property real handWaves: settings.lockRing.handWaves
    // The widget's default size, as a share of the screen height.
    readonly property real ringSize: settings.lockRing.ringSize
    readonly property bool running: pipeline !== null
    readonly property int bandCount: Kick.BANDS
    // The time every ring shows on its Hands and Digital Time, read on each of the rings' frames:
    // one clock, so every monitor's ring moves in step, and the second hand sweeps.
    property var now: new Date()
    // The rings' animation clock: real seconds times speed. The ring's own, not the pipeline's,
    // so the idle wave breathes on in Silence whatever the pipeline's clock does.
    property real time: 0
    // Whether the rings draw at Pace.SILENCE_FPS rather than every frame (pace.mjs): in Silence
    // (the pipeline's case), once the music has played out on the ring. The first sound ends it
    // at once. While slow, the music below is the music at rest (`resting`), so nothing the
    // pipeline still does redraws the rings between slow frames.
    readonly property bool slow: Pace.drawsSlowly(pipeline?.silence ?? "", rested)
    readonly property var resting: Pace.restingMusic(bandCount, heldFlow)
    readonly property var values: root.slow ? root.resting.values : (pipeline?.values ?? new Array(bandCount).fill(0))
    readonly property real bass: root.slow ? root.resting.bass : (pipeline?.bass ?? 0)
    readonly property real mid: root.slow ? root.resting.mid : (pipeline?.mid ?? 0)
    readonly property real treble: root.slow ? root.resting.treble : (pipeline?.treble ?? 0)
    readonly property real flow: root.slow ? root.resting.flow : (pipeline?.flow ?? 0)
    // 0..1, the last kick's impact, fading at kickDecay: the ribbons' kick punch.
    readonly property real kick: root.slow ? root.resting.kick : (pipeline?.kick ?? 0)
    // Kicks, for the Shockwave and flashing hands: the last kickSlots kicks, aged on the
    // pipeline's clock.
    readonly property var kickAges: root.slow ? root.resting.kickAges : (pipeline?.kickAges ?? [])
    readonly property var kickPowers: root.slow ? root.resting.kickPowers : (pipeline?.kickPowers ?? [])
    readonly property var kickSeeds: root.slow ? root.resting.kickSeeds : (pipeline?.kickSeeds ?? [])
    // The same kicks as the ring shader's slots (lock-ring/kicks.mjs): { ages, powers, seeds }, 8 each.
    readonly property var kickSlots: Kicks.kickSlots(kickAges, kickPowers, kickSeeds)
    // 0..1, how brightly all hands flash: lit by every kick together with its Shockwave and sparks.
    readonly property real flash: Kicks.handFlash(kickAges, kickPowers, settings.kickDecay)
    // 0..1, how brightly a Shockwave's front is crossing the digital time right now: its chromatic
    // split and glow (clock.mjs timeHit()), where each Kick's shaped front passes 6 o'clock, below
    // the center where the time sits. Here, so every ring's time takes the hit in sync.
    readonly property real timeCrossing: Kicks.shockwaveCrossing(Clock.TIME_RADIUS, kickAges, kickPowers, kickSeeds, Math.PI)
    // The ring's motion (lock-ring/ring.mjs): radius growth as a fraction of the dial radius, and
    // how much music the ribbon shows (0 = only its calm idle wave).
    property real swell: 0
    property real presence: 0
    // The hands' motion (hands.mjs createHandMotion()): each band as a share of its own recent
    // peak, for the hands' looks, and how far each hand's wave has travelled.
    property var handLevels: ({ bass: 0, mid: 0, treble: 0 })
    property var handPhases: ({ hour: 0, minute: 0, second: 0 })
    // The Lyric Words visible right now (docs/lyric-words.mjs words()), the same on every ring:
    // none while lockRing.lyrics is off, on a DMS without its lyrics service, or without synced
    // lyrics for the Active Player's song. Each says where it landed; LockRing.qml draws them. By
    // their id (LockLyrics.qml wordId()).
    readonly property var lyricWords: lyrics.item?.current ?? ({})
    // The same words as a model (LockLyrics.qml wordModel): one entry (wordId, text) per word
    // shown, kept while it is, so each keeps its drawing. Its wordId looks it up in lyricWords.
    readonly property var lyricWordModel: lyrics.item?.wordModel ?? null

    // How many rings hold the capture.
    property int holders: 0

    function join(ring) {
        holders = share.join(ring);
    }

    function leave(ring) {
        holders = share.leave(ring);
    }

    // ----------------------------------------------------------------------

    readonly property var share: Share.createShare()
    readonly property var pipeline: loader.item ?? null
    property var motion: Ring.createRingMotion()
    property var handMotion: Hands.createHandMotion()
    // Whether the music has played out on the ring (Pace.atRest()), as of its last frame.
    property bool rested: false
    // The pipeline's wave phase at the last frame drawn with the music: held while slow.
    property real heldFlow: 0
    // When the last frame was stepped (Date.now()), so a slow frame steps by the time it took.
    property real lastFrame: 0

    onRunningChanged: {
        if (running)
            return;
        motion = Ring.createRingMotion();
        handMotion = Hands.createHandMotion();
        swell = 0;
        presence = 0;
        handLevels = ({ bass: 0, mid: 0, treble: 0 });
        time = 0;
        rested = false;
        heldFlow = 0;
        lastFrame = 0;
    }

    // One frame of every ring, `dt` seconds after the last: the clocks, the ring's and the hands'
    // motion, and whether the music has played out on the ring.
    function frame(dt) {
        lastFrame = Date.now();
        now = new Date(lastFrame);
        time += dt * ringSettings.speed;
        const levels = { bass: bass, mid: mid, treble: treble };
        const m = motion.step(levels, dt);
        swell = m.swell;
        presence = m.presence;
        const h = handMotion.step(levels, dt, settings.speed);
        handLevels = h.levels;
        handPhases = h.phases;
        // While slow, LockLyrics.qml's own clock stops: its words step on this frame.
        if (slow && lyrics.item)
            lyrics.item.syncWords();
        rested = Pace.atRest({
            presence: presence,
            swell: swell,
            kick: pipeline?.kick ?? 0,
            kickAges: pipeline?.kickAges ?? [],
            kickPowers: pipeline?.kickPowers ?? [],
            words: lyricWords,
            silence: pipeline?.silence ?? ""
        });
        // Where the wave's phase is held once slow: as it is while the ring is at rest with the
        // music still shown (the ring goes slow then, or when Silence starts).
        if (rested && !slow)
            heldFlow = pipeline?.flow ?? 0;    }

    // config.json. Missing means the defaults, broken the last good settings.
    FileView {
        path: Config.configPath(Quickshell.env("XDG_CONFIG_HOME"), Quickshell.env("HOME"))
        watchChanges: true
        printErrors: false
        onFileChanged: reload()
        onLoaded: {
            try {
                root.settings = Config.parseConfig(text());
            } catch (e) {
                console.warn(`lockRing: config.json: ${e.message}; keeping the previous settings`);
            }
            root.settingsRead = true;
        }
        onLoadFailed: {
            root.settings = Config.DEFAULTS;
            root.settingsRead = true;
        }
    }

    // Whether config.json has been read (or found missing) yet: until then lockRing.lyrics isn't
    // known, and with it off, the track must not go to the lyrics providers even for a moment.
    property bool settingsRead: false

    // DMS's lyrics service, if this DMS has one (v2.0+). Looked for as a file, so an older DMS
    // never compiles LockLyrics.qml and logs nothing.
    property bool lyricsService: false

    FileView {
        path: Quickshell.shellPath("Services/LyricsService.qml")
        printErrors: false
        onLoaded: root.lyricsService = true
        onLoadFailed: root.lyricsService = false
    }

    // The Lyric Words' source, while a ring is shown and lyrics are on; it holds DMS's lyrics
    // subscription while loaded. A change to lockRing.lyrics applies at once.
    LazyLoader {
        id: lyrics
        active: root.holders > 0 && root.lyricsService && root.settingsRead && root.settings.lockRing.lyrics
        // Set only then: LazyLoader compiles its source even while inactive.
        source: root.lyricsService ? Qt.resolvedUrl("LockLyrics.qml") : ""
    }
    // While slow, the Lyric Words step on the rings' slow frame (frame()), not every frame.
    Binding {
        target: lyrics.item
        when: lyrics.item !== null
        property: "slow"
        value: root.slow
    }

    // Every Kick, with its power, so a word landing with it pops harder.
    Connections {
        target: root.pipeline
        function onKicked(power) { lyrics.item?.kick(power); }
    }

    LazyLoader {
        id: loader
        active: root.holders > 0

        // Its own cava conf, not the bar's: each installer stops only its own cava.
        AudioPipeline {
            settings: root.ringSettings
            // Any running frame clock keeps the rings redrawing every frame: the pipeline's
            // stops while they draw slowly (the music has played out on them by then).
            clockRunning: !root.slow
            confPath: `${Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"}/lock-ring-cava.conf`
        }
    }

    // Every frame, with something to hear or the music still playing out on the ring.
    FrameAnimation {
        running: root.running && !root.slow
        onTriggered: root.frame(frameTime)
    }

    // In Silence, at rest: SILENCE_FPS frames a second, each stepped by the time since the last.
    Timer {
        interval: 1000 / Pace.SILENCE_FPS
        repeat: true
        running: root.running && root.slow
        onTriggered: root.frame(Math.min(1, (Date.now() - root.lastFrame) / 1000))
    }
}

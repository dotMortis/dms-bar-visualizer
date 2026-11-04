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
import "ring.mjs" as Ring
import "kicks.mjs" as Kicks
import "hands.mjs" as Hands
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

    // --- Outputs ----------------------------------------------------------
    // The look settings, the same for every ring.
    readonly property real intensity: settings.intensity
    readonly property real bassStretch: settings.bassStretch
    readonly property real handWaves: settings.lockRing.handWaves
    // The widget's default size, as a share of the screen height.
    readonly property real ringSize: settings.lockRing.ringSize
    readonly property bool running: pipeline !== null
    readonly property int bandCount: Kick.BANDS
    readonly property var values: pipeline?.values ?? new Array(bandCount).fill(0)
    readonly property real bass: pipeline?.bass ?? 0
    readonly property real mid: pipeline?.mid ?? 0
    readonly property real treble: pipeline?.treble ?? 0
    readonly property real time: pipeline?.time ?? 0
    readonly property real flow: pipeline?.flow ?? 0
    // 0..1, the last kick's impact, fading at kickDecay: the ribbons' kick punch.
    readonly property real kick: pipeline?.kick ?? 0
    // Kicks, for the shockwave and flashing hands: the last kickSlots kicks.
    readonly property var kickAges: pipeline?.kickAges ?? []
    readonly property var kickPowers: pipeline?.kickPowers ?? []
    readonly property var kickSeeds: pipeline?.kickSeeds ?? []
    // The same kicks as the ring shader's slots (lock-ring/kicks.mjs): { ages, powers, seeds }, 8 each.
    readonly property var kickSlots: Kicks.kickSlots(kickAges, kickPowers, kickSeeds)
    // 0..1, how brightly all hands flash: lit by every kick together with its shockwave and sparks.
    readonly property real flash: Kicks.handFlash(kickAges, kickPowers, settings.kickDecay)
    // The ring's motion (lock-ring/ring.mjs): radius growth as a fraction of the dial radius, and
    // how much music the ribbon shows (0 = only its calm idle wave).
    property real swell: 0
    property real presence: 0
    // The hands' motion (hands.mjs createHandMotion()): each band as a share of its own recent
    // peak, for the hands' looks, and how far each hand's wave has travelled.
    property var handLevels: ({ bass: 0, mid: 0, treble: 0 })
    property var handPhases: ({ hour: 0, minute: 0, second: 0 })

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

    onRunningChanged: {
        if (running)
            return;
        motion = Ring.createRingMotion();
        handMotion = Hands.createHandMotion();
        swell = 0;
        presence = 0;
        handLevels = ({ bass: 0, mid: 0, treble: 0 });
    }

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
        }
        onLoadFailed: root.settings = Config.DEFAULTS
    }

    LazyLoader {
        id: loader
        active: root.holders > 0

        // Its own cava conf, not the bar's: each installer stops only its own cava.
        AudioPipeline {
            settings: root.settings
            confPath: `${Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"}/lock-ring-cava.conf`
        }
    }

    FrameAnimation {
        running: root.running
        onTriggered: {
            const levels = { bass: root.bass, mid: root.mid, treble: root.treble };
            const m = root.motion.step(levels, frameTime);
            root.swell = m.swell;
            root.presence = m.presence;
            const h = root.handMotion.step(levels, frameTime, root.settings.speed);
            root.handLevels = h.levels;
            root.handPhases = h.phases;
        }
    }
}

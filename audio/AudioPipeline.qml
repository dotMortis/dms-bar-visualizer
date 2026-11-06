// The audio pipeline both visualizers draw from: follows the Active Player, captures the output it
// plays to with cava while it plays, and turns that into bands, bass/mid/treble, Kicks, the wave
// phase and the Silence case. Knows nothing about where it's drawn, so the Lock Ring can bundle it
// (with active-player.mjs and silence.mjs next to it, and docs/kick.mjs and docs/config.mjs, which
// it imports from ../docs) without any Bar Visualizer code: lock-ring/audio/ and lock-ring/docs/
// hold relative symlinks to them, so the imports resolve the same inside the plugin dir.
//
//   AudioPipeline {
//       settings: config         // speed, kickDecay, kickThreshold, kickLowHz, kickHighHz, kickCooldown
//       confPath: ".../my-cava.conf"
//   }
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "active-player.mjs" as Player
import "silence.mjs" as Silence
import "../docs/kick.mjs" as Kick
import "../docs/config.mjs" as Config

Scope {
    id: root

    // --- Inputs -----------------------------------------------------------
    // The kick and animation settings (speed, kick*), by the same names in both visualizers
    // (docs/config.mjs). Missing keys fall back to its defaults; re-read whenever a new object is
    // assigned, other keys are ignored.
    readonly property var defaults: Config.DEFAULTS
    property var settings: defaults
    readonly property var effective: Object.assign({}, defaults, settings)
    // Where cava's config is written. Each visualizer uses its own, so their installers can find
    // and stop their own cava without touching the other's.
    required property string confPath
    // Whether the frame clock (time, flow and the kick decay) runs. The host's to stop: the Bar
    // Visualizer does in Silence once `settled`; the Lock Ring while it draws slowly in Silence
    // (it breathes on its own clock). Stopped, the animation stands still, and it runs on from
    // there, without a jump, when started again.
    property bool clockRunning: true

    // --- Outputs ----------------------------------------------------------
    // cava's layout, from docs/kick.mjs, which maps kickLowHz/kickHighHz to these bands.
    readonly property int bandCount: Kick.BANDS
    readonly property int lowCutoff: Kick.LOW_HZ      // cava's frequency range, split into log-spaced bands
    readonly property int highCutoff: Kick.HIGH_HZ
    property var values: new Array(bandCount).fill(0)
    property real bass: 0
    property real mid: 0
    property real treble: 0
    property real kick: 0
    property real time: 0   // animation clock: real seconds times speed
    property real flow: 0   // wave phase, advanced by audio energy so motion follows the music

    // The last kickSlots kicks, so a new kick's shockwave and particles add to the ones still
    // playing instead of restarting them. Ring buffer: the newest kick overwrites the oldest.
    readonly property int kickSlots: 8  // matches KICKS in shaders/viz.frag and docs/lock-ring/ring.frag
    property var kickTimes: new Array(kickSlots).fill(-100)
    property var kickPowers: new Array(kickSlots).fill(0)  // 0.5..1 by strength, 0 = empty slot
    property var kickSeeds: new Array(kickSlots).fill(0)   // a fresh particle spray per kick
    readonly property var kickAges: kickTimes.map(t => time - t)
    property int kickCount: 0
    // Each Kick as it lands, with its power (0.5..1), once the slots above hold it.
    signal kicked(real power)

    // Capture the monitor of the sink the Active Player plays to, falling back to the newest
    // playing stream. "auto" = default sink. Chosen by active-player.mjs (chooseSource).
    property string source: "auto"

    // The Active Player, chosen as DankBar does by active-player.mjs (chooseActivePlayer).
    property var activePlayer: null

    // Which Silence case applies (GLOSSARY.md), for both visualizers to decide from: "no-player",
    // "paused", "silent" (playing, but every band below Silence.THRESHOLD for Silence.HOLD s), or
    // "" when there is something to hear. Told by silence.mjs.
    property string silence: "no-player"
    // Whether the capture (cava) runs: only while the Active Player plays, silent or not, so the
    // first sound is caught. Stopped, the bands read as silent. Told by silence.mjs.
    readonly property bool capturing: Silence.capturing(activePlayer)

    // ----------------------------------------------------------------------

    // Shared with the demo, so a detector fix lands in both. Created once; settings changes only
    // reconfigure it, so its running state survives.
    readonly property var kickDetector: Kick.createKickDetector(defaults)
    // Follows the bands and the Active Player to tell the Silence case.
    readonly property var silenceTracker: Silence.createSilence()

    function updateActivePlayer() {
        activePlayer = Player.chooseActivePlayer(activePlayer, Mpris.players.values);
    }

    // Checks the capture source again: now, or right after the check already running, which may
    // have listed the streams before the change. Called through Qt.callLater, so a burst of
    // events is one check.
    property bool checkAgain: false
    function checkSource() {
        if (sinkProbe.running)
            checkAgain = true;
        else
            sinkProbe.running = true;
    }

    function updateSilence() {
        silence = silenceTracker.check(activePlayer, Date.now() / 1000);
    }

    function avg(from, to) {
        let sum = 0;
        for (let i = from; i < to; i++)
            sum += values[i];
        return sum / (to - from);
    }

    onEffectiveChanged: kickDetector.configure(effective)
    Component.onCompleted: {
        kickDetector.configure(effective);
        updateActivePlayer();
    }
    onActivePlayerChanged: Qt.callLater(checkSource)

    onSourceChanged: {
        cava.running = false;
        Qt.callLater(() => cava.running = root.capturing);
    }

    onCapturingChanged: {
        cava.running = capturing;
        if (!capturing)
            values = new Array(bandCount).fill(0);
        updateSilence();
    }
    // A handler of its own, apart from the Active Player tracking: the case changes with the player.
    Connections {
        target: root
        function onActivePlayerChanged() {
            root.updateSilence();
        }
    }
    // cava sends no frames at all once its sleep_timer stops it, so a playing player's silence is
    // also checked on a clock. Not in Silence, and not without a capture.
    Timer {
        interval: 250
        repeat: true
        running: root.capturing && root.silence !== "silent"
        onTriggered: root.updateSilence()
    }

    onValuesChanged: {
        bass = avg(0, 6);
        mid = avg(6, 16);
        treble = avg(16, bandCount);
        // Real time, not the animation clock: the detector follows the music at any speed and
        // scales kickCooldown by speed itself.
        const hit = kickDetector.push(values, Date.now() / 1000);
        if (!hit)
            return;
        kick = 1;
        kickCount = (kickCount + 1) % 1000;
        const slot = kickCount % kickSlots;
        // Copies, so the bindings that read these arrays see the change.
        const times = kickTimes.slice(), powers = kickPowers.slice(), seeds = kickSeeds.slice();
        times[slot] = time;
        powers[slot] = hit.power;
        seeds[slot] = kickCount;
        kickTimes = times;
        kickPowers = powers;
        kickSeeds = seeds;
        kicked(hit.power);
    }

    FrameAnimation {
        running: root.clockRunning
        onTriggered: {
            const speed = root.effective.speed;
            root.time += frameTime * speed;
            // Wrapped so the shader's 32-bit floats keep their precision; the shader only uses
            // flow times multiples of 1/20, so every ribbon is periodic in 40π and the wrap is seamless.
            root.flow = (root.flow + frameTime * speed * (8 * root.bass + 4 * root.mid + 6 * root.kick)) % (40 * Math.PI);
            root.kick *= Math.exp(-frameTime * root.effective.kickDecay);
        }
    }

    // Following the Active Player, by events only: nothing runs while nothing changes.
    // MPRIS: players coming and going, and each one's playback state.
    Connections {
        target: Mpris.players
        function onValuesChanged() {
            root.updateActivePlayer();
        }
    }
    Variants {
        model: Mpris.players.values
        Connections {
            required property var modelData
            target: modelData
            function onPlaybackStateChanged() {
                root.updateActivePlayer();
                // The Active Player may stay the same and only start or stop playing.
                root.updateSilence();
            }
        }
    }

    // The sound server: one long-lived `pactl subscribe`, whose stream and output events check the
    // source again (active-player.mjs rechecksSource). Each start checks too, for what happened
    // while none ran. If it dies (the sound server restarting), it's started again after a pause
    // that doubles while it keeps dying at once, up to a minute. One Process: never two at a time.
    Process {
        id: subscription
        property real startedAt: 0
        running: true
        command: ["pactl", "subscribe"]
        onStarted: {
            startedAt = Date.now();
            Qt.callLater(root.checkSource);
        }
        onExited: {
            resubscribe.interval = Date.now() - startedAt > 60000 ? 1000 : Math.min(resubscribe.interval * 2, 60000);
            resubscribe.restart();
        }
        stdout: SplitParser {
            onRead: line => {
                if (Player.rechecksSource(line))
                    Qt.callLater(root.checkSource);
            }
        }
    }
    Timer {
        id: resubscribe
        interval: 500  // doubled before its first use
        onTriggered: subscription.running = true
    }

    Process {
        id: sinkProbe
        command: ["sh", "-c", "pactl -f json list sinks; echo; pactl -f json list sink-inputs"]
        onExited: {
            if (root.checkAgain) {
                root.checkAgain = false;
                running = true;
            }
        }
        stdout: StdioCollector {
            onStreamFinished: {
                try {
                    const [sinksJson, inputsJson] = text.trim().split("\n");
                    root.source = Player.chooseSource(root.activePlayer, JSON.parse(sinksJson), JSON.parse(inputsJson));
                } catch (e) {
                    root.source = "auto";
                }
            }
        }
    }

    // The capture: a command that prints one line of bands per frame, as cava's raw ascii output
    // (docs/kick.mjs parseBands). cava, writing its config to confPath first and reading the source
    // above; runs while `capturing`, restarted whenever the source changes. Light smoothing on
    // purpose: transients should punch, not glide.
    property var captureCommand: ["sh", "-c", `cat <<'CAVACONF' > ${root.confPath}
[general]
framerate=60
bars=${root.bandCount}
autosens=1
sleep_timer=5
lower_cutoff_freq=${root.lowCutoff}
higher_cutoff_freq=${root.highCutoff}

[input]
method=pulse
source=${root.source}

[output]
method=raw
raw_target=/dev/stdout
data_format=ascii
ascii_max_range=1000
channels=mono
mono_option=average

[smoothing]
noise_reduction=8
CAVACONF
exec cava -p ${root.confPath} < /dev/null`]

    Process {
        id: cava
        running: root.capturing
        command: root.captureCommand

        stdout: SplitParser {
            onRead: data => {
                const bands = Kick.parseBands(data);
                if (!bands)
                    return;
                root.values = bands;
                root.silenceTracker.frame(bands, Date.now() / 1000);
                root.updateSilence();
            }
        }
    }
}

// The audio pipeline both visualizers draw from: follows the Active Player, captures the output it
// plays to with cava, and turns that into bands, bass/mid/treble, Kicks and the wave phase.
// Knows nothing about where it's drawn, so the Lock Ring can bundle it (with docs/kick.mjs, which it
// imports from ../docs) without any Bar Visualizer code: lock-ring/audio/ and lock-ring/docs/ hold
// relative symlinks to both, so the import resolves the same inside the plugin dir.
//
//   AudioPipeline {
//       settings: config         // speed, kickDecay, kickThreshold, kickLowHz, kickHighHz, kickCooldown
//       confPath: ".../my-cava.conf"
//   }
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "../docs/kick.mjs" as Kick

Scope {
    id: root

    // --- Inputs -----------------------------------------------------------
    // The kick and animation settings, by the same names in both visualizers. Missing keys fall
    // back to these defaults; re-read whenever a new object is assigned, other keys are ignored.
    readonly property var defaults: ({
        speed: 1.0,           // animation speed multiplier
        kickThreshold: 0.4,   // lower = more kicks detected
        kickDecay: 6.0,       // higher = shorter impact flashes
        kickLowHz: 20,        // frequency range the kick listens to
        kickHighHz: 90,
        kickCooldown: 0.1     // min seconds between kicks; 0 = no limit
    })
    property var settings: defaults
    readonly property var effective: Object.assign({}, defaults, settings)
    // Where cava's config is written. Each visualizer uses its own, so their installers can find
    // and stop their own cava without touching the other's.
    required property string confPath

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
    readonly property int kickSlots: 8  // matches KICKS in shaders/viz.frag
    property var kickTimes: new Array(kickSlots).fill(-100)
    property var kickPowers: new Array(kickSlots).fill(0)  // 0.5..1 by strength, 0 = empty slot
    property var kickSeeds: new Array(kickSlots).fill(0)   // a fresh particle spray per kick
    readonly property var kickAges: kickTimes.map(t => time - t)
    property int kickCount: 0

    // Capture the monitor of the sink the Active Player plays to, falling back to the newest
    // playing stream. "auto" = default sink.
    property string source: "auto"

    // The Active Player. Mirrors DankBar's choice: keep the current player while it plays,
    // otherwise switch to any player that starts playing; a paused player stays active until
    // another one plays.
    property var activePlayer: null

    // ----------------------------------------------------------------------

    // Shared with the demo, so a detector fix lands in both. Created once; settings changes only
    // reconfigure it, so its running state survives.
    readonly property var kickDetector: Kick.createKickDetector(defaults)

    function updateActivePlayer() {
        const players = Mpris.players.values;
        if (activePlayer && activePlayer.isPlaying && players.includes(activePlayer))
            return;
        const playing = players.find(p => p.isPlaying);
        if (playing)
            activePlayer = playing;
        else if (!players.includes(activePlayer))
            activePlayer = players[0] ?? null;
    }

    function matchesActivePlayer(stream) {
        const p = root.activePlayer;
        if (!p)
            return false;
        const keys = [p.identity, p.desktopEntry, p.dbusName?.replace(/^org\.mpris\.MediaPlayer2\./, "").split(".")[0]]
            .filter(Boolean).map(k => k.toLowerCase());
        const props = stream.properties;
        const names = [props["application.name"], props["application.process.binary"], props["application.id"], props["node.name"]]
            .filter(Boolean).map(n => n.toLowerCase());
        return names.some(n => keys.some(k => n === k || n.startsWith(k) || k.startsWith(n)));
    }

    function avg(from, to) {
        let sum = 0;
        for (let i = from; i < to; i++)
            sum += values[i];
        return sum / (to - from);
    }

    onEffectiveChanged: kickDetector.configure(effective)
    Component.onCompleted: kickDetector.configure(effective)
    onActivePlayerChanged: sinkProbe.running = true

    onSourceChanged: {
        cava.running = false;
        Qt.callLater(() => cava.running = true);
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
    }

    FrameAnimation {
        running: true
        onTriggered: {
            const speed = root.effective.speed;
            root.time += frameTime * speed;
            // Wrapped so the shader's 32-bit floats keep their precision; the shader only uses
            // flow times multiples of 1/20, so every ribbon is periodic in 40π and the wrap is seamless.
            root.flow = (root.flow + frameTime * speed * (8 * root.bass + 4 * root.mid + 6 * root.kick)) % (40 * Math.PI);
            root.kick *= Math.exp(-frameTime * root.effective.kickDecay);
        }
    }

    Timer {
        interval: 2000
        running: true
        repeat: true
        triggeredOnStart: true
        onTriggered: {
            root.updateActivePlayer();
            sinkProbe.running = true;
        }
    }

    Process {
        id: sinkProbe
        command: ["sh", "-c", "pactl -f json list sinks; echo; pactl -f json list sink-inputs"]
        stdout: StdioCollector {
            onStreamFinished: {
                try {
                    const [sinksJson, inputsJson] = text.trim().split("\n");
                    const sinks = JSON.parse(sinksJson);
                    const playing = JSON.parse(inputsJson).filter(i => !i.corked).sort((a, b) => b.index - a.index);
                    const stream = playing.find(root.matchesActivePlayer) ?? playing[0];
                    const sink = stream ? sinks.find(s => s.index === stream.sink) : null;
                    root.source = sink ? `${sink.name}.monitor` : "auto";
                } catch (e) {
                    root.source = "auto";
                }
            }
        }
    }

    // Light smoothing on purpose: transients should punch, not glide.
    Process {
        id: cava
        running: true
        command: ["sh", "-c", `cat <<'CAVACONF' > ${root.confPath}
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

        stdout: SplitParser {
            onRead: data => {
                const parts = data.split(";");
                if (parts.length < root.bandCount)
                    return;
                const next = new Array(root.bandCount);
                for (let i = 0; i < root.bandCount; i++)
                    next[i] = parseInt(parts[i], 10) / 1000;
                root.values = next;
            }
        }
    }
}

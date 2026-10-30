// Audio visualizer drawn behind the DankMaterialShell top bar.
// Sits on the "bottom" layer, so the (transparent) DMS bar on the "top" layer renders over it.
// Run: qs -c bar-visualizer   (install.sh links this repo to ~/.config/quickshell/bar-visualizer)
// After editing shaders/viz.frag, recompile: ./install.sh --no-service, or see the header of that file.
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Services.Mpris
import Quickshell.Wayland
import "docs/kick.mjs" as Kick

ShellRoot {
    id: root

    // --- Tweakables -------------------------------------------------------
    // ~/.config/bar-visualizer/config.json overrides any of these by key and is re-read when it
    // changes; a key removed from it falls back here. If the file is missing, it's created with these.
    // Geometry must match the DMS bar. With a maximized window on a screen's active workspace,
    // DMS drops the spacing and rounding (its "maximize detection"); followMaximize mirrors that.
    readonly property var defaults: ({
        barThickness: 40,     // DMS bar body height (from innerPadding/font scale)
        spacing: 4,           // DMS "spacing"
        radius: 12,           // DMS cornerRadius
        followMaximize: true, // match DMS "maximizeDetection"
        intensity: 1.0,       // overall brightness of the effect
        speed: 1.0,           // animation speed multiplier
        kickThreshold: 0.2,   // lower = more kicks detected
        kickDecay: 6.0,       // higher = shorter impact flashes
        kickLowHz: 30,        // frequency range the kick (shockwave + particles) listens to
        kickHighHz: 79,
        kickCooldown: 0.1,    // min seconds between kicks; 0 = no limit
        bassStretch: 1.4      // >1 spreads bass (centre) wider; 1 = linear
    })
    property var config: defaults

    readonly property string configDir: `${Quickshell.env("XDG_CONFIG_HOME") || Quickshell.env("HOME") + "/.config"}/bar-visualizer`

    // FileView watches the file through its directory, so a directory that doesn't exist yet
    // (first run) would leave it unwatched until a restart. Create it before handing over the path.
    Process {
        running: true
        command: ["mkdir", "-p", root.configDir]
        onExited: configFile.path = `${root.configDir}/config.json`
    }

    FileView {
        id: configFile
        watchChanges: true
        printErrors: false  // a missing file just means defaults
        onFileChanged: reload()
        // Merged over the defaults on every load, so removed keys reset. A half-written or broken
        // file keeps the last good settings.
        onLoaded: {
            try {
                root.config = Object.assign({}, root.defaults, JSON.parse(text()));
            } catch (e) {
                console.warn(`config.json: ${e.message}; keeping the previous settings`);
            }
        }
        onLoadFailed: error => {
            root.config = root.defaults;
            if (error == FileViewError.FileNotFound)
                setText(JSON.stringify(root.defaults, null, 4) + "\n");
        }
    }

    readonly property int barThickness: config.barThickness
    readonly property int spacing: config.spacing
    readonly property int radius: config.radius
    readonly property bool followMaximize: config.followMaximize
    readonly property real intensity: config.intensity
    readonly property real speed: config.speed
    readonly property real kickDecay: config.kickDecay
    readonly property real bassStretch: config.bassStretch
    // ----------------------------------------------------------------------

    // cava's layout, from docs/kick.mjs, which maps kickLowHz/kickHighHz to these bands.
    readonly property int bandCount: Kick.BANDS
    readonly property int lowCutoff: Kick.LOW_HZ      // cava's frequency range, split into log-spaced bands
    readonly property int highCutoff: Kick.HIGH_HZ
    property var values: new Array(bandCount).fill(0)
    property real bass: 0
    property real mid: 0
    property real treble: 0
    property real kick: 0
    property real time: 0
    property real flow: 0   // wave phase, advanced by audio energy so motion follows the music

    // The last kickSlots kicks, so a new kick's shockwave and particles add to the ones still
    // playing instead of restarting them. Ring buffer: the newest kick overwrites the oldest.
    readonly property int kickSlots: 8  // matches KICKS in shaders/viz.frag
    property var kickTimes: new Array(kickSlots).fill(-100)
    property var kickPowers: new Array(kickSlots).fill(0)  // 0.5..1 by strength, 0 = empty slot
    property var kickSeeds: new Array(kickSlots).fill(0)   // a fresh particle spray per kick
    readonly property var kickAges: kickTimes.map(t => time - t)
    property int kickCount: 0

    // Shared with the demo, so a detector fix lands in both.
    readonly property var kickDetector: Kick.createKickDetector(defaults)

    readonly property string confPath: `${Quickshell.env("XDG_RUNTIME_DIR")}/bar-visualizer-cava.conf`

    // Capture the monitor of the sink the active MPRIS player (the one the DMS bar shows) plays to,
    // falling back to the newest playing stream. "auto" = default sink.
    property string source: "auto"

    // Mirrors DankBar's choice: keep the current player while it plays, otherwise switch to
    // any player that starts playing; a paused player stays active until another one plays.
    property var activePlayer: null

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

    function quad(arr, i) {
        return Qt.vector4d(arr[i], arr[i + 1], arr[i + 2], arr[i + 3]);
    }

    onConfigChanged: kickDetector.configure(config)
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
        // scales kickCooldown by config.speed itself.
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
            root.time += frameTime * root.speed;
            // Wrapped so the shader's 32-bit floats keep their precision; the shader only uses
            // flow times multiples of 1/20, so every ribbon is periodic in 40π and the wrap is seamless.
            root.flow = (root.flow + frameTime * root.speed * (8 * root.bass + 4 * root.mid + 6 * root.kick)) % (40 * Math.PI);
            root.kick *= Math.exp(-frameTime * root.kickDecay);
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

    Variants {
        model: Quickshell.screens

        PanelWindow {
            id: panel
            required property var modelData
            screen: modelData

            // Same rule as DMS: any maximized window on this monitor's active workspace.
            readonly property bool hasMaximized: {
                if (!root.followMaximize)
                    return false;
                const wsId = Hyprland.monitorFor(modelData)?.activeWorkspace?.id;
                if (wsId === undefined)
                    return false;
                return Hyprland.toplevels.values.some(t => t.workspace?.id === wsId && t.wayland?.maximized);
            }
            property real inset: hasMaximized ? 0 : root.spacing
            property real cornerRadius: hasMaximized ? 0 : root.radius
            Behavior on inset { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }
            Behavior on cornerRadius { NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }

            anchors {
                top: true
                left: true
                right: true
            }
            implicitHeight: root.barThickness + root.spacing
            exclusionMode: ExclusionMode.Ignore
            color: "transparent"
            mask: Region {}  // click-through

            WlrLayershell.layer: WlrLayer.Bottom
            WlrLayershell.namespace: "bar-visualizer"

            ShaderEffect {
                anchors.top: parent.top
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.topMargin: panel.inset
                anchors.leftMargin: panel.inset
                anchors.rightMargin: panel.inset
                height: root.barThickness
                fragmentShader: Qt.resolvedUrl("shaders/viz.frag.qsb")

                // Wrapped for 32-bit precision. 1200 s keeps the hue cycles seamless (t*0.05, t*0.2);
                // only the kick-only plasma haze and shake can jump at the wrap.
                property real time: root.time % 1200
                property real bass: root.bass
                property real mid: root.mid
                property real treble: root.treble
                property real kick: root.kick
                property real radius: panel.cornerRadius
                property vector4d kickAge0: root.quad(root.kickAges, 0)
                property vector4d kickAge1: root.quad(root.kickAges, 4)
                property vector4d kickPower0: root.quad(root.kickPowers, 0)
                property vector4d kickPower1: root.quad(root.kickPowers, 4)
                property vector4d kickSeed0: root.quad(root.kickSeeds, 0)
                property vector4d kickSeed1: root.quad(root.kickSeeds, 4)
                property real intensity: root.intensity
                property real bassStretch: root.bassStretch
                property real flow: root.flow
                property vector2d res: Qt.vector2d(width, height)
                property vector4d b0: root.quad(root.values, 0)
                property vector4d b1: root.quad(root.values, 4)
                property vector4d b2: root.quad(root.values, 8)
                property vector4d b3: root.quad(root.values, 12)
                property vector4d b4: root.quad(root.values, 16)
                property vector4d b5: root.quad(root.values, 20)
                property vector4d b6: root.quad(root.values, 24)
                property vector4d b7: root.quad(root.values, 28)
            }
        }
    }
}

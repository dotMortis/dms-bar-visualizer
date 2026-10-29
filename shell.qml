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

ShellRoot {
    id: root

    // --- Tweakables -------------------------------------------------------
    // Geometry must match the DMS bar. With a maximized window on a screen's active workspace,
    // DMS drops the spacing and rounding (its "maximize detection"); followMaximize mirrors that.
    readonly property int barThickness: 40  // DMS bar body height (from innerPadding/font scale)
    readonly property int spacing: 4        // DMS "spacing"
    readonly property int radius: 12        // DMS cornerRadius
    readonly property bool followMaximize: true // match DMS "maximizeDetection"
    readonly property real intensity: 1.0   // overall brightness of the effect
    readonly property real speed: 1.0       // animation speed multiplier
    readonly property real kickThreshold: 0.10 // lower = more kicks detected
    readonly property real kickDecay: 6.0   // higher = shorter impact flashes
    readonly property real bassStretch: 1.8 // >1 spreads bass (centre) wider; 1 = linear
    // ----------------------------------------------------------------------

    readonly property int bandCount: 32
    property var values: new Array(bandCount).fill(0)
    property real bass: 0
    property real mid: 0
    property real treble: 0
    property real kick: 0
    property real time: 0
    property real flow: 0   // wave phase, advanced by audio energy so motion follows the music

    property real kickPower: 0  // strength of the latest kick, 0.5..1
    property int kickCount: 0   // seeds a fresh particle spray per kick
    readonly property real kickAge: time - _lastKick

    property real _slowBass: 0
    property real _lastKick: -100

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

    function band4(i) {
        return Qt.vector4d(values[i], values[i + 1], values[i + 2], values[i + 3]);
    }

    onActivePlayerChanged: sinkProbe.running = true

    onSourceChanged: {
        cava.running = false;
        Qt.callLater(() => cava.running = true);
    }

    onValuesChanged: {
        bass = avg(0, 6);
        mid = avg(6, 16);
        treble = avg(16, bandCount);
        // Kick = bass jumping well above its recent average.
        _slowBass = _slowBass * 0.92 + bass * 0.08;
        const jump = bass - _slowBass;
        if (jump > kickThreshold && bass > 0.15 && time - _lastKick > 0.12) {
            kick = 1;
            kickPower = Math.min(1, 0.5 + jump * 2);
            kickCount = (kickCount + 1) % 1000;
            _lastKick = time;
        }
    }

    FrameAnimation {
        running: true
        onTriggered: {
            root.time += frameTime * root.speed;
            root.flow += frameTime * root.speed * (8 * root.bass + 4 * root.mid + 6 * root.kick);
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
lower_cutoff_freq=30
higher_cutoff_freq=14000

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

                property real time: root.time
                property real bass: root.bass
                property real mid: root.mid
                property real treble: root.treble
                property real kick: root.kick
                property real radius: panel.cornerRadius
                property real kickAge: root.kickAge
                property real kickPower: root.kickPower
                property real kickSeed: root.kickCount
                property real intensity: root.intensity
                property real bassStretch: root.bassStretch
                property real flow: root.flow
                property vector2d res: Qt.vector2d(width, height)
                property vector4d b0: root.band4(0)
                property vector4d b1: root.band4(4)
                property vector4d b2: root.band4(8)
                property vector4d b3: root.band4(12)
                property vector4d b4: root.band4(16)
                property vector4d b5: root.band4(20)
                property vector4d b6: root.band4(24)
                property vector4d b7: root.band4(28)
            }
        }
    }
}

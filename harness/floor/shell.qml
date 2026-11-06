// Quickshell's floor (#50, docs/performance.md), a stand-in for the Bar Visualizer's shell.qml:
// harness/run --host floor|floor-pipe|floor-parse. The bar's window and shader (viz.frag, which
// harness/run links in from the tree under test) as v0.10.0 draws them, redrawn every frame, with
// no script per frame: time and flow run on native NumberAnimations, the bands are constant, and
// there's no Kick detector, no Lyric Words and no sink probe. BVH_FLOOR_MODE (harness/run sets it
// from the host) picks what reads the capture:
//   floor  the capture runs, qs doesn't read its output
//   pipe   qs reads every line (SplitParser), the handler does nothing
//   parse  qs reads every line and parses it as v0.10.0's AudioPipeline did
// The uniforms below are v0.10.0's viz.frag's: measure it with --commit v0.10.0 (or any commit
// whose viz.frag takes the same).
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Services.Mpris

ShellRoot {
    id: root

    readonly property string mode: Quickshell.env("BVH_FLOOR_MODE") || "floor"
    // v0.10.0's defaults (docs/config.mjs DEFAULTS), fixed here so the floor stays the floor.
    readonly property var defaults: ({ barThickness: 40, spacing: 4, radius: 12, intensity: 1.0, bassStretch: 1.4 })
    // Read once, so the harness sees the stand-in player read.
    readonly property var player: Mpris.players.values[0] ?? null
    readonly property bool playing: player ? player.isPlaying : false
    readonly property int bandCount: 32
    property var values: new Array(bandCount).fill(0)
    property real time: 0
    property real flow: 0

    NumberAnimation on time { from: 0; to: 1200; duration: 1200000; loops: Animation.Infinite; running: true }
    NumberAnimation on flow { from: 0; to: 125.66; duration: 60000; loops: Animation.Infinite; running: true }

    readonly property string cavaCmd: `printf '' > ${Quickshell.env("XDG_RUNTIME_DIR")}/bar-visualizer-cava.conf; exec cava -p ${Quickshell.env("XDG_RUNTIME_DIR")}/bar-visualizer-cava.conf < /dev/null`

    Process {
        running: root.mode === "floor"
        command: ["sh", "-c", root.cavaCmd + " > /dev/null"]
    }
    Process {
        running: root.mode === "pipe"
        command: ["sh", "-c", root.cavaCmd]
        stdout: SplitParser { onRead: data => {} }
    }
    Process {
        running: root.mode === "parse"
        command: ["sh", "-c", root.cavaCmd]
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
            required property var modelData
            screen: modelData
            anchors { top: true; left: true; right: true }
            implicitHeight: root.defaults.barThickness + root.defaults.spacing
            exclusionMode: ExclusionMode.Ignore
            color: "transparent"
            mask: Region {}
            WlrLayershell.layer: WlrLayer.Bottom
            WlrLayershell.namespace: "bar-visualizer"

            ShaderEffect {
                anchors.top: parent.top
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.margins: root.defaults.spacing
                height: root.defaults.barThickness
                fragmentShader: Qt.resolvedUrl("viz.frag.qsb")

                property real time: root.time
                property real bass: 0.45
                property real mid: 0.35
                property real treble: 0.2
                property real kick: 0
                property real radius: root.defaults.radius
                property vector4d kickAge0: Qt.vector4d(100, 100, 100, 100)
                property vector4d kickAge1: Qt.vector4d(100, 100, 100, 100)
                property vector4d kickPower0: Qt.vector4d(0, 0, 0, 0)
                property vector4d kickPower1: Qt.vector4d(0, 0, 0, 0)
                property vector4d kickSeed0: Qt.vector4d(0, 0, 0, 0)
                property vector4d kickSeed1: Qt.vector4d(0, 0, 0, 0)
                property real intensity: root.defaults.intensity
                property real bassStretch: root.defaults.bassStretch
                property real flow: root.flow
                property vector2d res: Qt.vector2d(width, height)
                property vector4d b0: Qt.vector4d(0.6, 0.55, 0.5, 0.45)
                property vector4d b1: Qt.vector4d(0.4, 0.4, 0.35, 0.35)
                property vector4d b2: Qt.vector4d(0.3, 0.3, 0.3, 0.3)
                property vector4d b3: Qt.vector4d(0.3, 0.25, 0.25, 0.25)
                property vector4d b4: Qt.vector4d(0.2, 0.2, 0.2, 0.2)
                property vector4d b5: Qt.vector4d(0.2, 0.15, 0.15, 0.15)
                property vector4d b6: Qt.vector4d(0.1, 0.1, 0.1, 0.1)
                property vector4d b7: Qt.vector4d(0.1, 0.05, 0.05, 0.05)
            }
        }
    }
}

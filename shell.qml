// Audio visualizer drawn behind the DankMaterialShell top bar.
// Sits on the "bottom" layer, so the (transparent) DMS bar on the "top" layer renders over it.
// Run: qs -c bar-visualizer   (install.sh links this repo to ~/.config/quickshell/bar-visualizer)
// After editing shaders/viz.frag, recompile: ./install.sh --no-service, or see the header of that file.
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import "audio"
import "docs/config.mjs" as Config
// The Ribbons' shape outside the shader (shaders/viz.frag mirrors it), for what rides them.
import "docs/bar-ribbons.mjs" as BarRibbons

ShellRoot {
    id: root

    // --- Tweakables -------------------------------------------------------
    // All in ~/.config/bar-visualizer/config.json, with their defaults in docs/config.mjs: one
    // file for both visualizers (ADR 0004). It's re-read when it changes, and a key removed from
    // it falls back to its default. If the file is missing, it's created with the defaults.
    readonly property var defaults: Config.DEFAULTS
    property var config: defaults

    readonly property string configDir: Config.configDir(Quickshell.env("XDG_CONFIG_HOME"), Quickshell.env("HOME"))

    // FileView watches the file through its directory, so a directory that doesn't exist yet
    // (first run) would leave it unwatched until a restart. Create it before handing over the path.
    Process {
        running: true
        command: ["mkdir", "-p", root.configDir]
        onExited: configFile.path = Config.configPath(Quickshell.env("XDG_CONFIG_HOME"), Quickshell.env("HOME"))
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
                root.config = Config.parseConfig(text());
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
    readonly property real bassStretch: config.bassStretch
    // ----------------------------------------------------------------------

    function quad(arr, i) {
        return Qt.vector4d(arr[i], arr[i + 1], arr[i + 2], arr[i + 3]);
    }

    // Active Player, capture, bands, Kicks and wave phase; shared by every screen.
    AudioPipeline {
        id: audio
        settings: root.config
        confPath: `${Quickshell.env("XDG_RUNTIME_DIR")}/bar-visualizer-cava.conf`
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
                property real time: audio.time % 1200
                property real bass: audio.bass
                property real mid: audio.mid
                property real treble: audio.treble
                property real kick: audio.kick
                property real radius: panel.cornerRadius
                property vector4d kickAge0: root.quad(audio.kickAges, 0)
                property vector4d kickAge1: root.quad(audio.kickAges, 4)
                property vector4d kickPower0: root.quad(audio.kickPowers, 0)
                property vector4d kickPower1: root.quad(audio.kickPowers, 4)
                property vector4d kickSeed0: root.quad(audio.kickSeeds, 0)
                property vector4d kickSeed1: root.quad(audio.kickSeeds, 4)
                property real intensity: root.intensity
                property real bassStretch: root.bassStretch
                property real flow: audio.flow
                property vector2d res: Qt.vector2d(width, height)
                property vector4d b0: root.quad(audio.values, 0)
                property vector4d b1: root.quad(audio.values, 4)
                property vector4d b2: root.quad(audio.values, 8)
                property vector4d b3: root.quad(audio.values, 12)
                property vector4d b4: root.quad(audio.values, 16)
                property vector4d b5: root.quad(audio.values, 20)
                property vector4d b6: root.quad(audio.values, 24)
                property vector4d b7: root.quad(audio.values, 28)
            }
        }
    }
}

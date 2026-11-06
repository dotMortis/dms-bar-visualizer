// The Lock Ring host's shell (harness/run --host lock): the plugin from the tree under test
// (HARNESS_TREE), created from its file:// URL with Qt.createComponent and given what DMS gives a
// lock-screen widget (Services/PluginService.qml, Modules/Plugins/DesktopWidgetContent.qml), in a
// layer-shell window of its default size at the top left, click-through, on black. harness/run
// copies this dir into the run and, for a scenario without DMS, removes Services/ and the import
// of qs.Services below (a DMS without its lyrics service).
import QtQuick
import Quickshell
import Quickshell.Wayland
// Unused here: Quickshell serves the plugin only the qs.* modules its shell imports.
import qs.Common
import qs.Modules.Plugins
import qs.Services
ShellRoot {
    PanelWindow {
        id: win
        screen: Quickshell.screens[0]
        anchors { top: true; left: true }
        implicitWidth: loader.item?.defaultWidth ?? 576
        implicitHeight: loader.item?.defaultHeight ?? 576
        color: "black"
        exclusionMode: ExclusionMode.Ignore
        WlrLayershell.layer: WlrLayer.Overlay
        WlrLayershell.namespace: "lock-ring-harness"
        mask: Region {}
        readonly property var plugin: Qt.createComponent("file://" + Quickshell.env("HARNESS_TREE") + "/lock-ring/LockRing.qml", Component.PreferSynchronous, win)
        Component.onCompleted: if (plugin.status === Component.Error) console.warn("harness: the Lock Ring didn't load: " + plugin.errorString())
        Loader {
            id: loader
            anchors.fill: parent
            sourceComponent: win.plugin
            onLoaded: {
                item.pluginId = "lockRing";
                item.lockScreen = true;
                item.widgetWidth = Qt.binding(() => loader.width);
                item.widgetHeight = Qt.binding(() => loader.height);
                item.screen = Qt.binding(() => win.screen);
            }
        }
    }
}

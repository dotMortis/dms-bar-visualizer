// Stand-in for DMS's DesktopPluginComponent (Modules/Plugins/), the Lock Ring's root type: its
// properties, which DMS sets on a loaded widget. No plugin data: the Lock Ring reads config.json.
import QtQuick

Item {
    property var pluginService: null
    property string pluginId: ""
    property string instanceId: ""
    property var instanceData: null
    property bool lockScreen: false

    property real widgetWidth: 200
    property real widgetHeight: 200
    property real minWidth: 100
    property real minHeight: 100

    property var requestResize: null
    property var clearResize: null

    property var pluginData: ({})

    function getData(key, defaultValue) {
        return pluginData[key] ?? defaultValue;
    }

    function setData(key, value) {
    }
}

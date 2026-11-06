// Stand-in for DMS's SettingsData (Common/): the settings the Lock Ring reads, as the user's DMS
// has them (24 h clock, no lock-screen font of its own).
pragma Singleton
import Quickshell

Singleton {
    property bool use24HourClock: true
    property bool padHours12Hour: false
    property string lockScreenFontFamily: ""

    function getPluginSettingsForPlugin(pluginId) {
        return ({});
    }
}

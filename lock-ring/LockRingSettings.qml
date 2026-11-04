// The Lock Ring's page in DMS's plugin settings, opened from the widget's options under
// Settings -> Lock Screen. A slider per setting in settings.mjs.
//
// DMS hands a desktop plugin's settings page a pluginService that stores into that one widget's
// config. The tweakables drive the one capture all rings share, so this page routes them to the
// plugin-wide store instead (PluginService.savePluginData -> plugin_settings.json), where
// LockAudio reads them; only DMS's own per-widget keys (which displays show the widget) still go
// to the widget (ADR 0002). That's why the root is a plain Item and not PluginSettings: DMS would
// replace a PluginSettings' pluginService with its per-widget one.
import QtQuick
import qs.Common
import qs.Services
import qs.Modules.Plugins
import qs.DCommon.Widgets
import "settings.mjs" as Settings

Item {
    id: root

    // Injected by DMS: the per-widget store.
    property var pluginService: null

    width: parent?.width ?? 0
    implicitHeight: page.implicitHeight
    height: implicitHeight

    // DMS calls this once the services are in.
    function reloadChildValues() {
        for (let i = 0; i < sliders.count; i++)
            sliders.itemAt(i)?.loadValue();
    }

    // The tweakables plugin-wide, everything else per widget.
    QtObject {
        id: router

        readonly property var availablePlugins: PluginService.availablePlugins

        signal pluginDataChanged(string pluginId)

        function storeFor(key) {
            return Settings.isPluginWide(key) ? PluginService : root.pluginService;
        }

        function loadPluginData(pluginId, key, defaultValue) {
            return storeFor(key)?.loadPluginData(pluginId, key, defaultValue) ?? defaultValue;
        }

        function savePluginData(pluginId, key, value) {
            return storeFor(key)?.savePluginData(pluginId, key, value) ?? false;
        }

        function getPluginVariants(pluginId) {
            return PluginService.getPluginVariants(pluginId);
        }
    }

    Connections {
        target: PluginService

        function onPluginDataChanged(pluginId) {
            router.pluginDataChanged(pluginId);
        }
    }

    Connections {
        target: root.pluginService
        ignoreUnknownSignals: true

        function onPluginDataChanged(pluginId) {
            router.pluginDataChanged(pluginId);
        }
    }

    // Values saved in another window (or another widget's page) show up here.
    Connections {
        target: router

        function onPluginDataChanged(pluginId) {
            if (pluginId === Settings.PLUGIN_ID)
                root.reloadChildValues();
        }
    }

    PluginSettings {
        id: page

        width: root.width
        pluginId: Settings.PLUGIN_ID
        pluginService: root.pluginService ? router : null

        onPluginServiceChanged: Qt.callLater(root.reloadChildValues)

        Column {
            width: parent?.width ?? 0
            spacing: Theme.spacingM

            StyledText {
                width: parent.width
                text: "These settings apply to every Lock Ring, on every monitor: they all share one audio capture."
                font.pixelSize: Theme.fontSizeSmall
                color: Theme.surfaceVariantText
                wrapMode: Text.WordWrap
            }

            Repeater {
                id: sliders

                model: Settings.SETTINGS

                SliderSetting {
                    required property var modelData
                    readonly property var spec: Settings.sliderOf(modelData)

                    settingKey: spec.settingKey
                    label: spec.label
                    description: spec.description
                    defaultValue: spec.defaultValue
                    minimum: spec.minimum
                    maximum: spec.maximum
                    unit: spec.unit
                }
            }
        }
    }
}

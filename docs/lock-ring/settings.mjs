// The Lock Ring's own settings: the ones the Bar Visualizer doesn't have, shown in DMS's plugin
// settings (LockRingSettings.qml) and read by the shared capture (LockAudio.qml). One plugin-wide
// set, not one per widget, because every ring draws from the same capture (ADR 0002). The settings
// both visualizers have (intensity, speed, kick*, bassStretch) are read from the bar's
// config.json instead (docs/config.mjs, ADR 0004), so they're tuned in one place.
// Plain JS for tests/lock-settings.test.mjs.
//
// DMS's SliderSetting stores integers only, so each setting is stored as round(value * scale) and
// read back as stored / scale. To add one, add an entry here: the settings page and the ring pick
// it up.

export const PLUGIN_ID = "lockRing";

// key, label, description, default/min/max in real units, scale to the stored integer, slider unit.
export const SETTINGS = [
    // hands.mjs handLook()'s strength.
    { key: "handWaves", label: "Hand waves",
        description: "How far the hands swing with the music and on kicks. 0% = straight hands.",
        default: 1.0, min: 0, max: 2, scale: 100, unit: "%" },
    // The widget's default size (LockRing.qml defaultWidth/defaultHeight), as a share of the
    // screen height. Resizing the widget in DMS still sets its size.
    { key: "ringSize", label: "Ring size",
        description: "The widget's default size, as a share of the screen height. Resizing the widget still works.",
        default: 0.4, min: 0.2, max: 0.8, scale: 100, unit: "%" },
];

const BY_KEY = new Map(SETTINGS.map(s => [s.key, s]));

// The SliderSetting for a setting, in stored integers.
export function sliderOf(setting) {
    const toStored = v => Math.round(v * setting.scale);
    return {
        settingKey: setting.key,
        label: setting.label,
        description: setting.description,
        defaultValue: toStored(setting.default),
        minimum: toStored(setting.min),
        maximum: toStored(setting.max),
        unit: setting.unit,
    };
}

// Every setting in real units, from what DMS stores for the plugin (missing or broken keys get the
// default). A new object each call, so the pipeline re-reads it.
export function resolve(stored) {
    const out = {};
    for (const s of SETTINGS) {
        const raw = stored?.[s.key];
        out[s.key] = typeof raw === "number" && Number.isFinite(raw) ? raw / s.scale : s.default;
    }
    return out;
}

// Whether DMS stores `key` once for the plugin, rather than per widget (like displayPreferences).
export function isPluginWide(key) {
    return BY_KEY.has(key);
}

// The Lock Ring's settings: the one list of its tweakables, shown in DMS's plugin settings
// (LockRingSettings.qml) and read by the shared capture (LockAudio.qml). One plugin-wide set, not
// one per widget, because every ring draws from the same capture and kick detector (ADR 0002).
// Defaults are the Bar Visualizer's (shell.qml, audio/AudioPipeline.qml), except for the Lock
// Ring's own (lockOnly); the Lock Ring never reads the bar's config.json. Plain JS for tests/lock-settings.test.mjs.
//
// DMS's SliderSetting stores integers only, so each setting is stored as round(value * scale) and
// read back as stored / scale. To add one, add an entry here: the settings page and the ring pick
// it up.

export const PLUGIN_ID = "lockRing";

// key, label, description, default/min/max in real units, scale to the stored integer, slider unit.
export const SETTINGS = [
    { key: "intensity", label: "Intensity", description: "Overall brightness of the ring.",
        default: 1.0, min: 0.2, max: 2, scale: 100, unit: "%" },
    { key: "speed", label: "Speed", description: "Animation speed.",
        default: 1.0, min: 0.2, max: 2.5, scale: 100, unit: "%" },
    { key: "kickThreshold", label: "Kick threshold",
        description: "How sharply the kick range must jump, as a share of its recent peak. Lower = more kicks.",
        default: 0.4, min: 0.06, max: 0.9, scale: 100, unit: "%" },
    { key: "kickDecay", label: "Kick decay", description: "How fast a kick's flash fades, in tenths. Higher = shorter.",
        default: 6.0, min: 1, max: 15, scale: 10, unit: "" },
    { key: "kickLowHz", label: "Kick range from", description: "The lowest frequency the kick listens to.",
        default: 20, min: 20, max: 500, scale: 1, unit: "Hz" },
    { key: "kickHighHz", label: "Kick range to", description: "The highest frequency the kick listens to.",
        default: 90, min: 40, max: 1000, scale: 1, unit: "Hz" },
    { key: "kickCooldown", label: "Kick cooldown", description: "Shortest time between two kicks. 0 = no limit.",
        default: 0.1, min: 0, max: 0.5, scale: 1000, unit: "ms" },
    { key: "bassStretch", label: "Bass stretch",
        description: "Spreads the bass over more of the ring. 100% = linear.",
        default: 1.4, min: 1, max: 3, scale: 100, unit: "%" },
    // The Lock Ring's own (lockOnly: no Bar Visualizer counterpart): hands.mjs handLook()'s strength.
    { key: "handWaves", label: "Hand waves",
        description: "How far the hands swing with the music and on kicks. 0% = straight hands.",
        default: 1.0, min: 0, max: 2, scale: 100, unit: "%", lockOnly: true },
    // The Lock Ring's own: the widget's default size (LockRing.qml defaultWidth/defaultHeight), as a
    // share of the screen height. Resizing the widget in DMS still sets its size.
    { key: "ringSize", label: "Ring size",
        description: "The widget's default size, as a share of the screen height. Resizing the widget still works.",
        default: 0.4, min: 0.2, max: 0.8, scale: 100, unit: "%", lockOnly: true },
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

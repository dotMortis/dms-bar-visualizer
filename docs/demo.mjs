// The live demo's controls, apart from the page: which view it shows (the Bar Visualizer or the
// Lock Ring), the sliders each view has, and how the Lock Ring view's sliders become the plugin's
// settings. Plain JS for tests/demo.test.mjs; docs/index.html imports it.
//
// Both views tune one set of values (DEFAULTS), so a tweak carries over when switching. The
// Lock Ring's sliders are its plugin settings (lock-ring/settings.mjs), and the ring runs on them
// as DMS stores them (ringSettings), so it reacts to a slider exactly as the plugin does.
import { handPoses } from "./lock-ring/hands.mjs";
import { kickSlots } from "./lock-ring/kicks.mjs";
import { SETTINGS, resolve } from "./lock-ring/settings.mjs";

export const VIEWS = ["bar", "ring"];

// The bar's defaults from shell.qml, plus the ring's own: its size (DMS sizes the widget; the
// demo picks one that fits the page) and DMS's 12h/24h clock setting.
export const DEFAULTS = {
    barThickness: 40, spacing: 4, radius: 12,
    intensity: 1.0, speed: 1.0, kickThreshold: 0.4, kickDecay: 6.0, kickLowHz: 20, kickHighHz: 90,
    kickCooldown: 0.1, bassStretch: 1.4, handWaves: 1.0,
    ringSize: 360, use24Hour: true,
};

const slider = (key, min, max, step, hint) => ({ key, min, max, step, hint });

// The bar view's sliders: every tweakable in shell.qml.
const BAR = [
    slider("intensity", 0.2, 2, 0.05, "Overall brightness"),
    slider("speed", 0.2, 2.5, 0.05, "Animation speed"),
    slider("kickThreshold", 0.06, 0.9, 0.01, "Jump needed, as a fraction of the recent peak. Lower = more kicks"),
    slider("kickDecay", 1, 15, 0.5, "Higher = shorter impact"),
    slider("kickLowHz", 20, 500, 5, "Kick listens from this frequency"),
    slider("kickHighHz", 40, 1000, 5, "Kick listens up to this frequency"),
    slider("kickCooldown", 0, 0.5, 0.01, "Min seconds between kicks (0 = no limit)"),
    slider("bassStretch", 1, 3, 0.1, "Spreads bass from the centre"),
    slider("barThickness", 28, 96, 1, "Bar height (px)"),
    slider("spacing", 0, 24, 1, "Gap around the bar (px)"),
    slider("radius", 0, 32, 1, "Corner radius (px)"),
];
const BAR_BY_KEY = new Map(BAR.map(s => [s.key, s]));

// The ring view's sliders: the plugin's settings, in its order and with its descriptions (the
// Lock Ring's own, like handWaves, in 5% steps), then the ones only the ring has.
const RING = [
    ...SETTINGS.map(s => ({ ...(BAR_BY_KEY.get(s.key) ?? slider(s.key, s.min, s.max, 0.05)), min: s.min, max: s.max, hint: s.description })),
    slider("ringSize", 160, 640, 10, "The widget's size (px). DMS sizes it when you resize the widget"),
];

// The view a URL hash opens: #ring for the Lock Ring, anything else the Bar Visualizer.
export function viewFromHash(hash) {
    return hash === "#ring" ? "ring" : "bar";
}

// The sliders `view` shows: { key, min, max, step, hint } each.
export function slidersFor(view) {
    return view === "ring" ? RING : BAR;
}

// What DMS stores for the Lock Ring (plugin_settings.json, under lockRing) with these values:
// each setting as the integer its SliderSetting keeps.
export function pluginSettings(values) {
    const out = {};
    for (const s of SETTINGS)
        out[s.key] = Math.round(values[s.key] * s.scale);
    return out;
}

// The settings the Lock Ring runs on with these values, read back from what DMS stores.
export function ringSettings(values) {
    return resolve(pluginSettings(values));
}

// A ring slider's value as the plugin's settings page shows it: "40 %", "250 ms", "30 Hz".
export function settingText(key, value) {
    if (key === "ringSize")
        return `${value} px`;
    const s = SETTINGS.find(s => s.key === key);
    const stored = Math.round(value * s.scale);
    return s.unit ? `${stored} ${s.unit}` : String(stored);
}

// The dial's radius as a fraction of half the widget (LockRing.qml: dialRadius = size * 0.34).
export const DIAL = 0.34 / 0.5;

// The ring shader's uniforms, by name, as LockRing.qml binds them, from the pipeline's state:
// bands (32, bass first), time, flow, treble, the last kicks (kickAges/kickPowers/kickSeeds),
// the ring's motion (swell, presence, lock-ring/ring.mjs) and the look settings. The hands come
// from the local time `now`, bass, mid, treble, the kick `flash` (kicks.mjs handFlash()) and the
// handWaves setting; `dialRadius` is the dial's radius in pixels. A vec4 is an array of 4.
export function ringUniforms(state) {
    const quad = (arr, i) => [arr[i] ?? 0, arr[i + 1] ?? 0, arr[i + 2] ?? 0, arr[i + 3] ?? 0];
    const slots = kickSlots(state.kickAges, state.kickPowers, state.kickSeeds);
    const u = {
        time: state.time % 1200, flow: state.flow, treble: state.treble,
        swell: state.swell, presence: state.presence, dial: DIAL,
        intensity: state.intensity, bassStretch: state.bassStretch,
        pixel: 1 / state.dialRadius, handFlash: state.flash,
    };
    const poses = handPoses(state.now, { bass: state.bass, mid: state.mid, treble: state.treble },
        { flash: state.flash, strength: state.handWaves });
    const perHand = (key, scale = 1) => [poses.hour[key] * scale, poses.minute[key] * scale, poses.second[key] * scale, 0];
    u.handAngle = perHand("angle", Math.PI / 180);
    u.handLength = perHand("length");
    u.handAmp = perHand("amplitude");
    u.handWidth = perHand("width");
    u.handGlow = perHand("glow");
    for (const [name, arr] of [["kickAge", slots.ages], ["kickPower", slots.powers], ["kickSeed", slots.seeds]]) {
        u[`${name}0`] = quad(arr, 0);
        u[`${name}1`] = quad(arr, 4);
    }
    for (let i = 0; i < 8; i++)
        u[`b${i}`] = quad(state.values, i * 4);
    return u;
}

// The live demo's controls, apart from the page: which view it shows (the Bar Visualizer or the
// Lock Ring) and the sliders each view has. Plain JS for tests/demo.test.mjs; docs/index.html
// imports it.
//
// Both views tune one set of values, shaped like config.json (config.mjs), so a tweak carries
// over when switching, as it does on the desktop: both visualizers read the same file (ADR 0004).
// "Export config.json" downloads them as they are.
import { DEFAULTS as CONFIG, lockRingSettings } from "./config.mjs";
import { handPoses } from "./lock-ring/hands.mjs";
import { kickSlots } from "./lock-ring/kicks.mjs";
import { DIAL_RATIO } from "./lock-ring/ring.mjs";

export const VIEWS = ["bar", "ring"];

// cava's layout, which the page's sources stand in for: 32 bands from 30 Hz to 14 kHz, bass first.
export const BANDS = 32;
export const LOW_HZ = 30;
export const HIGH_HZ = 14000;

// Where each field of a glyph instance sits in the core's glyphs().data (core/src/glyph.rs's Glyph,
// core/src/wasm.rs): glyph i starts at i * stride; color and core are r, g, b; copies holds three
// copies, each copySize numbers from copyColor (r, g, b), copyDx and copyOpacity on.
// core/tests/glyphs.rs checks them against the core's.
export const GLYPH = {
    letter: 0, word: 1, x: 2, y: 3, angle: 4, scale: 5, pivotX: 6, pivotY: 7, color: 8, core: 11, opacity: 14,
    glow: 15, glowSpread: 16, blur: 17, white: 18, em: 19, copies: 20,
    copyColor: 0, copyDx: 3, copyOpacity: 4, copySize: 5, stride: 35,
};

// A fresh copy of config.json's defaults, for the sliders to change.
export function defaults() {
    return structuredClone(CONFIG);
}

// The value at `key` in `values`: a top-level key, or "section.key".
export function valueAt(values, key) {
    return key.split(".").reduce((v, k) => v?.[k], values);
}

// Sets the value at `key` in `values` (see valueAt).
export function setValueAt(values, key, value) {
    const path = key.split(".");
    const last = path.pop();
    path.reduce((v, k) => v[k], values)[last] = value;
}

const slider = (key, min, max, step, hint) => ({ key, min, max, step, hint });

// The look and audio settings, which both views have.
const SHARED = [
    slider("intensity", 0.2, 2, 0.05, "Overall brightness"),
    slider("speed", 0.2, 2.5, 0.05, "Animation speed"),
    slider("kickThreshold", 0.06, 0.9, 0.01, "Jump needed, as a fraction of the recent peak. Lower = more kicks"),
    slider("kickDecay", 1, 15, 0.5, "Higher = shorter impact"),
    slider("kickLowHz", 20, 500, 5, "Kick listens from this frequency"),
    slider("kickHighHz", 40, 1000, 5, "Kick listens up to this frequency"),
    slider("kickCooldown", 0, 0.5, 0.01, "Min seconds between kicks (0 = no limit)"),
    slider("bassStretch", 1, 3, 0.1, "Spreads bass from the centre"),
];

// The bar view's sliders: the shared ones, then the bar's geometry.
const BAR = [
    ...SHARED,
    slider("barThickness", 28, 96, 1, "Bar height (px)"),
    slider("spacing", 0, 24, 1, "Gap around the bar (px)"),
    slider("radius", 0, 32, 1, "Corner radius (px)"),
];

// The ring view's sliders: the shared ones, then the Lock Ring's own (config.json's lockRing).
const RING = [
    ...SHARED,
    slider("lockRing.handWaves", 0, 2, 0.05, "How far the hands swing with the music and on kicks. 0 = straight hands"),
    slider("lockRing.ringSize", 0.2, 0.8, 0.05, "The widget's default size, as a share of the screen height"),
    slider("lockRing.intensityPercent", 0, 300, 5, "The Lock Ring's brightness, in % of intensity"),
    slider("lockRing.kickLowHzPercent", 0, 300, 5, "The Lock Ring's kick range from, in % of kickLowHz"),
    slider("lockRing.kickHighHzPercent", 0, 300, 5, "The Lock Ring's kick range up to, in % of kickHighHz"),
    slider("lockRing.kickThresholdPercent", 0, 300, 5, "The Lock Ring's kick threshold, in % of kickThreshold. Lower = more kicks"),
    slider("lockRing.kickCooldownPercent", 0, 300, 5, "The Lock Ring's kick cooldown, in % of kickCooldown"),
];

// The settings `view` runs on, as config.json's text for the core's configure(): the Lock Ring's
// are the bar's with its percentages applied, as in lock-ring/LockAudio.qml.
export function coreSettings(values, view) {
    return JSON.stringify(view === "ring" ? lockRingSettings(values) : values);
}

// The view a URL hash opens: #ring for the Lock Ring, anything else the Bar Visualizer.
export function viewFromHash(hash) {
    return hash === "#ring" ? "ring" : "bar";
}

// The sliders `view` shows: { key, min, max, step, hint } each.
export function slidersFor(view) {
    return view === "ring" ? RING : BAR;
}

// The Lock Ring widget's side in pixels at `ringSize` (the setting: a share of the screen height),
// with the page standing in for the screen. It stays inside a narrow page.
export function ringSide(ringSize, pageWidth, pageHeight) {
    return Math.min(Math.round(pageHeight * ringSize), pageWidth - 24);
}

// The dial's radius as a fraction of half the widget (LockRing.qml: dialRadius = size * DIAL_RATIO).
export const DIAL = DIAL_RATIO / 0.5;

// The ring shader's uniforms, by name, as LockRing.qml binds them, from the pipeline's state:
// bands (32, bass first), time, flow, treble, kick, the last kicks (kickAges/kickPowers/kickSeeds),
// the ring's motion (swell, presence, lock-ring/ring.mjs) and the look settings. The hands come
// from the local time `now`, the hand motion's `handLevels` and `handPhases` (hands.mjs
// createHandMotion()), the kick `flash` (kicks.mjs handFlash()) and the handWaves setting;
// `dialRadius` is the dial's radius in pixels. A vec4 is an array of 4.
export function ringUniforms(state) {
    const quad = (arr, i) => [arr[i] ?? 0, arr[i + 1] ?? 0, arr[i + 2] ?? 0, arr[i + 3] ?? 0];
    const slots = kickSlots(state.kickAges, state.kickPowers, state.kickSeeds);
    const u = {
        time: state.time % 1200, flow: state.flow, treble: state.treble, kick: state.kick ?? 0,
        swell: state.swell, presence: state.presence, dial: DIAL,
        intensity: state.intensity, bassStretch: state.bassStretch,
        pixel: 1 / state.dialRadius, handFlash: state.flash,
    };
    const poses = handPoses(state.now, state.handLevels, { flash: state.flash, strength: state.handWaves });
    const perHand = (key, scale = 1) => [poses.hour[key] * scale, poses.minute[key] * scale, poses.second[key] * scale, 0];
    u.handAngle = perHand("angle", Math.PI / 180);
    u.handInner = perHand("inner");
    u.handLength = perHand("length");
    u.handAmp = perHand("amplitude");
    u.handWidth = perHand("width");
    u.handGlow = perHand("glow");
    const phases = state.handPhases ?? {};
    u.handPhase = [phases.hour ?? 0, phases.minute ?? 0, phases.second ?? 0, 0];
    for (const [name, arr] of [["kickAge", slots.ages], ["kickPower", slots.powers], ["kickSeed", slots.seeds]]) {
        u[`${name}0`] = quad(arr, 0);
        u[`${name}1`] = quad(arr, 4);
    }
    for (let i = 0; i < 8; i++)
        u[`b${i}`] = quad(state.values, i * 4);
    return u;
}

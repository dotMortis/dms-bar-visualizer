// The live demo's controls, apart from the page: which view it shows (the Bar Visualizer or the
// Lock Ring) and the sliders each view has. Plain JS for tests/demo.test.mjs; docs/index.html
// imports it.
//
// Both views tune one set of values, shaped like config.json (config.mjs), so a tweak carries
// over when switching, as it does on the desktop: both visualizers read the same file (ADR 0004).
// "Export config.json" downloads them as they are.
import { DEFAULTS as CONFIG } from "./config.mjs";
import { DIAL_RATIO } from "./lock-ring/ring.mjs";

export const VIEWS = ["bar", "ring"];

// cava's layout, which the page's sources stand in for: 32 bands from 30 Hz to 14 kHz, bass first.
export const BANDS = 32;
export const LOW_HZ = 30;
export const HIGH_HZ = 14000;

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

// The settings both views run on, as config.json's text for the core's configure(): the sliders'
// values as they are. The core applies the Lock Ring's percentages itself (ADR 0005) once it is
// the Lock Ring kind (coreKind()).
export function coreSettings(values) {
    return JSON.stringify(values);
}

// The core's kind for `view` (setKind()): the Lock Ring's for the ring view, else the bar's.
export function coreKind(view) {
    return view === "ring" ? "lock-ring" : "bar";
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

// The ring shader's uniforms, by name, as LockRing.qml binds them: straight from the core's frame()
// (`frame`: bands, time, flow, treble, kick, intensity, bassStretch) and lockRing() (`ring`: the
// ring's motion, the hands, the shader's Kick slots), the core being the Lock Ring kind with the
// local time set. `dialRadius` is the dial's radius in pixels. A vec4 is an array of 4; the hands'
// are hour, minute, second and 0.
export function ringUniforms(frame, ring, dialRadius) {
    const quad = (arr, i) => [arr[i] ?? 0, arr[i + 1] ?? 0, arr[i + 2] ?? 0, arr[i + 3] ?? 0];
    const u = {
        time: frame.time, flow: frame.flow, treble: frame.treble, kick: frame.kick,
        swell: ring.swell, presence: ring.presence, dial: DIAL,
        intensity: frame.intensity, bassStretch: frame.bassStretch,
        pixel: 1 / dialRadius, handFlash: ring.handFlash,
        handAngle: quad(ring.handAngles, 0), handInner: quad(ring.handInner, 0), handLength: quad(ring.handLengths, 0),
        handAmp: quad(ring.handAmplitudes, 0), handWidth: quad(ring.handWidths, 0), handGlow: quad(ring.handGlows, 0),
        handPhase: quad(ring.handPhases, 0),
    };
    for (const [name, arr] of [["kickAge", ring.kickAges], ["kickPower", ring.kickPowers], ["kickSeed", ring.kickSeeds]]) {
        u[`${name}0`] = quad(arr, 0);
        u[`${name}1`] = quad(arr, 4);
    }
    for (let i = 0; i < 8; i++)
        u[`b${i}`] = quad(frame.bands, i * 4);
    return u;
}

// The local time of day at `date`, in seconds since local midnight: what the core's
// setLocalTime() takes for the Lock Ring's Hands.
export function localSeconds(date) {
    return date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000;
}

// How the Digital Time takes a Shockwave's hit, from the core's lockRing() (`ring`), shaped as
// lock-ring/clock.mjs timeHit() gives it, for drawing: each split copy (in `colors`, TIME_HIT's
// split colors) with its offset and opacity, the glow's opacity and scale, the flare to white.
export function timeHitOf(ring, colors) {
    return {
        copies: colors.map((color, i) => ({ color, offset: ring.timeCopyOffsets[i], opacity: ring.timeCopyOpacity })),
        glow: { opacity: ring.timeGlowOpacity, scale: ring.timeGlowScale },
        white: ring.timeWhite,
    };
}

// The Bar Visualizer's Ribbons, apart from drawing: where each of the three Ribbons sits at any x
// across the bar, its color there, and how brightly a Shockwave crosses it. Plain JS for
// tests/bar-ribbons.test.mjs, and for what rides the Ribbons (Lyric Words, in shell.qml). shaders/viz.frag and the demo's port of it in docs/index.html draw them and
// mirror these numbers (tests/bar-constants.test.mjs checks they match), so change both together.

// The Ribbons' wave, in bar-heights along the bar (x) and shares of its thickness across it (y):
// strand k waves at freq + k * freqStep a bar-height, its phase the flow times 1 + k * speedStep,
// offset by k * offset. The treble rides on it as a ripple (rippleFreq times as fine, its phase
// ripplePhase times as fast) of `ripple` its height. At full level a crest reaches `reach` from the
// bar's middle line. viz.frag's RIBBON_* constants.
// Its color is the palette at the bar's hue (HUE), hueStep on per strand, hueSpread more at the
// edges than at the center and hueLevel more at full level, deepened by `deep` (0..1, pal()'s s).
export const RIBBON = {
    freq: 2.6, freqStep: 1.4, speedStep: 0.5, offset: 2.1, ripple: 0.3, rippleFreq: 2.3, ripplePhase: 1.7, reach: 0.42,
    hueStep: 0.33, hueSpread: 0.6, hueLevel: 0.2, deep: 0.9,
};

// The bar's hue: it moves `speed` a second through the palette and `along` a bar-height across the
// bar. A color deepened by d (0..1) has each channel to the power 1 + deepen * d, so the additive
// glow doesn't wash the pastels out to white. viz.frag's HUE_* constants and pal().
export const HUE = { speed: 0.05, along: 0.004, deepen: 1.5 };

// The palette, Catppuccin Mocha, lavender-led: it cycles lavender, mauve, lavender, pink, lavender,
// blue, easing between them. viz.frag's vec3 constants of these names, uppercase, and palette().
export const PALETTE = {
    lavender: [0.706, 0.745, 0.996],
    mauve: [0.796, 0.651, 0.969],
    pink: [0.961, 0.761, 0.906],
    blue: [0.537, 0.706, 0.980],
};
const CYCLE = [PALETTE.lavender, PALETTE.mauve, PALETTE.lavender, PALETTE.pink, PALETTE.lavender, PALETTE.blue, PALETTE.lavender];

// The level the Ribbons wave with: the spectrum's there times `gain`, `kick` more on a Kick, plus
// `surge` times the Shockwaves passing, capped at 1. viz.frag's LEVEL_* constants.
export const LEVEL = { gain: 1.3, kick: 0.7, surge: 0.6 };

// A Kick's Shockwave: its front eases out from the center at `grow` (as a share of the way to the
// edge, 1 - e^(-grow * age)) and fades at `fade`; it lifts the Ribbons within about sqrt(width)
// of its front. viz.frag's SHOCK_* constants.
export const SHOCK = { grow: 4.5, fade: 2.2, width: 0.003 };

// The whole picture shakes on a Kick (by kick²): `x` bar-heights along and `y` of the thickness
// across, wobbling at freqX and freqY radians a second. viz.frag's SHAKE_* constants.
export const SHAKE = { x: 0.35, y: 0.12, freqX: 97, freqY: 83 };

// The spectrum at s (0 = bass .. 1), linearly between the 32 bands. viz.frag's spectrum().
function spectrum(values, s) {
    const f = Math.min(1, Math.max(0, s)) * 31;
    const i = Math.floor(f);
    const a = values[i] || 0, b = values[Math.min(i + 1, 31)] || 0;
    return a + (b - a) * (f - i);
}

// Where `x` (pixels from the bar's left edge) falls in viz.frag's picture, from its inputs (see
// ribbonHeight()): p.x in bar-heights (shaken), the shake across, dx (bar-heights from the center)
// and s (0 at the center .. 1 at the edges).
function spotOf(x, { width, height, time = 0, kick = 0 }) {
    const k2 = kick * kick;
    const px = x / height + Math.sin(time * SHAKE.freqX) * SHAKE.x * k2;
    const cx = width / height * 0.5;
    const dx = Math.abs(px - cx);
    return { px, dx, s: dx / cx, shakeY: Math.cos(time * SHAKE.freqY) * SHAKE.y * k2 };
}

// The level the Ribbons wave with at s, 0..1 (viz.frag's amp).
function levelAt(s, { values, kick = 0, bassStretch = 1, kickAges = [], kickPowers = [] }) {
    let surge = 0;
    for (let j = 0; j < kickAges.length; j++) {
        const age = kickAges[j], power = kickPowers[j] || 0;
        const front = s - (1 - Math.exp(-age * SHOCK.grow));
        surge += power * Math.exp(-age * SHOCK.fade) * Math.exp(-front * front / SHOCK.width);
    }
    return Math.min(1, LEVEL.gain * spectrum(values, s ** bassStretch) * (1 + LEVEL.kick * kick) + LEVEL.surge * surge);
}

// The height of Ribbon `strand` (0..2) at `x` pixels from the bar's left edge, as a share of the
// bar's thickness from its top edge (the shader's qt_TexCoord0.y), from what viz.frag gets:
//   width, height          the bar in pixels (viz.frag's res)
//   values                 the 32 bands, bass first, 0..1
//   time, kick, treble, flow, bassStretch   as the shader's uniforms of those names
//   kickAges, kickPowers   the Kicks' slots (a power of 0 is an empty slot)
// The intensity only brightens the Ribbons, so it isn't needed here. The Ribbons wave outward from
// the bar's center and mirror there, and can leave the bar on a loud crest (above 1 or below 0).
export function ribbonHeight(x, strand, inputs) {
    const { dx, s, shakeY } = spotOf(x, inputs);
    const { treble = 0, flow = 0 } = inputs;
    const level = levelAt(s, inputs);
    const freq = RIBBON.freq + strand * RIBBON.freqStep;
    const phase = flow * (1 + strand * RIBBON.speedStep) + strand * RIBBON.offset;
    const wave = Math.sin(dx * freq - phase) + RIBBON.ripple * Math.sin(dx * freq * RIBBON.rippleFreq - phase * RIBBON.ripplePhase) * treble;
    return 0.5 + RIBBON.reach * level * wave - shakeY;
}

const smoothstep = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// The palette at hue h (any number; it cycles once a unit). viz.frag's palette().
function palette(h) {
    const f = (h - Math.floor(h)) * 6;
    const i = Math.floor(f), m = smoothstep(0, 1, f - i);
    return CYCLE[i].map((c, k) => c + (CYCLE[i + 1][k] - c) * m);
}

// The color of Ribbon `strand` at `x`, as [r, g, b] 0..1, from the same inputs as ribbonHeight():
// the color viz.frag gives its glow there, before the intensity and the glow's brightness.
export function ribbonColor(x, strand, inputs) {
    const { px, s } = spotOf(x, inputs);
    const hue = (inputs.time || 0) * HUE.speed + px * HUE.along
        + strand * RIBBON.hueStep + s * RIBBON.hueSpread + levelAt(s, inputs) * RIBBON.hueLevel;
    const power = 1 + HUE.deepen * RIBBON.deep;
    return palette(hue).map(c => c ** power);
}

// How far ahead of a Shockwave's front, and how far behind it, a spot still feels it crossing, as
// shares of the way from the center to an edge (shockwaveCrossing()). Not in viz.frag.
export const CROSSING = { lead: 0.08, trail: 0.25 };

// How brightly a Shockwave's front is crossing `x` right now, 0..1, from ribbonHeight()'s inputs:
// each Shockwave with its strength (its power, faded at SHOCK.fade), shaped by how close its front
// is: nothing until it is within CROSSING.lead, full strength as it passes, gone CROSSING.trail
// beyond. Overlapping Shockwaves take the brightest. What makes Lyric Words flare and split.
export function shockwaveCrossing(x, inputs) {
    const { s } = spotOf(x, inputs);
    const { kickAges = [], kickPowers = [] } = inputs;
    let crossing = 0;
    for (let j = 0; j < kickAges.length; j++) {
        const age = kickAges[j], power = kickPowers[j] || 0;
        const ds = s - (1 - Math.exp(-age * SHOCK.grow));
        const near = ds >= 0 ? 1 - smoothstep(0, CROSSING.lead, ds) : 1 - smoothstep(0, CROSSING.trail, -ds);
        crossing = Math.max(crossing, power * Math.exp(-age * SHOCK.fade) * near);
    }
    return Math.min(1, crossing);
}

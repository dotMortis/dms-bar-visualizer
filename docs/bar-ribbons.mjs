// The Bar Visualizer's Ribbons, apart from drawing: where each of the three Ribbons sits at any x
// across the bar. Plain JS for tests/bar-ribbons.test.mjs, and for whatever rides the Ribbons
// (Lyric Words). shaders/viz.frag and the demo's port of it in docs/index.html draw them and
// mirror these numbers (tests/bar-constants.test.mjs checks they match), so change both together.

// The Ribbons' wave, in bar-heights along the bar (x) and shares of its thickness across it (y):
// strand k waves at freq + k * freqStep a bar-height, its phase the flow times 1 + k * speedStep,
// offset by k * offset. The treble rides on it as a ripple (rippleFreq times as fine, its phase
// ripplePhase times as fast) of `ripple` its height. At full level a crest reaches `reach` from the
// bar's middle line. viz.frag's RIBBON_* constants.
export const RIBBON = { freq: 2.6, freqStep: 1.4, speedStep: 0.5, offset: 2.1, ripple: 0.3, rippleFreq: 2.3, ripplePhase: 1.7, reach: 0.42 };

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

// The height of Ribbon `strand` (0..2) at `x` pixels from the bar's left edge, as a share of the
// bar's thickness from its top edge (the shader's qt_TexCoord0.y), from what viz.frag gets:
//   width, height          the bar in pixels (viz.frag's res)
//   values                 the 32 bands, bass first, 0..1
//   time, kick, treble, flow, bassStretch   as the shader's uniforms of those names
//   kickAges, kickPowers   the Kicks' slots (a power of 0 is an empty slot)
// The intensity only brightens the Ribbons, so it isn't needed here. The Ribbons wave outward from
// the bar's center and mirror there, and can leave the bar on a loud crest (above 1 or below 0).
export function ribbonHeight(x, strand, { width, height, values, time = 0, kick = 0, treble = 0, flow = 0, bassStretch = 1, kickAges = [], kickPowers = [] }) {
    const k2 = kick * kick;
    const shakeX = Math.sin(time * SHAKE.freqX) * SHAKE.x * k2;
    const shakeY = Math.cos(time * SHAKE.freqY) * SHAKE.y * k2;
    const cx = width / height * 0.5;
    const dx = Math.abs(x / height + shakeX - cx);
    const s = dx / cx;
    let surge = 0;
    for (let j = 0; j < kickAges.length; j++) {
        const age = kickAges[j], power = kickPowers[j] || 0;
        const front = s - (1 - Math.exp(-age * SHOCK.grow));
        surge += power * Math.exp(-age * SHOCK.fade) * Math.exp(-front * front / SHOCK.width);
    }
    const level = Math.min(1, LEVEL.gain * spectrum(values, s ** bassStretch) * (1 + LEVEL.kick * kick) + LEVEL.surge * surge);
    const freq = RIBBON.freq + strand * RIBBON.freqStep;
    const phase = flow * (1 + strand * RIBBON.speedStep) + strand * RIBBON.offset;
    const wave = Math.sin(dx * freq - phase) + RIBBON.ripple * Math.sin(dx * freq * RIBBON.rippleFreq - phase * RIBBON.ripplePhase) * treble;
    return 0.5 + RIBBON.reach * level * wave - shakeY;
}

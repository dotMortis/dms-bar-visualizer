// The Lock Ring's hands, apart from drawing: where they point and how they look. Each hand is a
// neon wave ribbon, like the Bar Visualizer's (shaders/viz.frag), showing one band: the band
// swings it, thickens it and lights it up, and every Kick whips it. The hands float: each starts a
// small gap (INNER) out from the center, so they never meet there. The wave only bends a hand
// sideways around its straight axis, which runs through the center at the true time: the angle
// comes from clock.mjs alone. Plain JS for tests/lock-hands.test.mjs; shaders/ring.frag draws the
// hands and mirrors waveEnvelope() and waveOffset().
//
// Lengths, widths and amplitudes are in dial radii (1 = the dial), as in the shader.
import { handAngles } from "./clock.mjs";

// Each hand: the band it shows, its color (Catppuccin Mocha, as in shaders/viz.frag; ring.frag
// has the same), its plain shape in silence (length from the center and thickness, in dial radii),
// and how hard a kick whips it (the short, thick hour hand gets busy at full whip).
export const HANDS = {
    hour: { band: "bass", color: "#b4befe", length: 0.52, thickness: 0.03, whip: 0.55 },
    minute: { band: "mid", color: "#cba6f7", length: 0.78, thickness: 0.02, whip: 1 },
    second: { band: "treble", color: "#f5c2e7", length: 0.88, thickness: 0.011, whip: 1 },
};

// Where every hand starts, in dial radii from the center: the gap that keeps them apart.
export const INNER = 0.1;

// How strongly the hands react: at a band level of 1 (cava's full scale), and at a full kick flash.
export const LOOK = {
    boost: 1.25,    // band levels are taken this much louder, so typical music already swings hard
    swing: 0.12,    // the wave's amplitude at full level, as a share of the hand's length
    whip: 0.12,     // added on a full kick flash, as a share of the hand's length
    thicken: 0.3,   // the hand gets this much thicker than plain at full level (0.3 = 1.3x): slim
};

// The wave along a hand. u runs along it, 0 at its inner end to 1 at the tip; offsets are sideways
// from its straight axis, in the same units as the amplitude.
export const WAVE = {
    periods: 1.5,   // wave periods from the inner end to the tip
    rise: 0.3,      // the bend grows from nothing at the inner end to full by here
    fall: 0.35,     // and eases back over this last part of the hand
    tip: 0.12,      // to this share of full at the tip, so the tip stays by the axis
    ripple: 0.15,   // share of the wave the treble turns into a faster ripple
};

const clamp01 = x => Math.min(1, Math.max(0, x || 0));

const smoothstep = (a, b, x) => {
    const t = clamp01((x - a) / (b - a));
    return t * t * (3 - 2 * t);
};

// How much of the amplitude the wave may use at u: 0 at the inner end, 1 along the middle, WAVE.tip at
// the tip.
export function waveEnvelope(u) {
    const fall = smoothstep(1 - WAVE.fall, 1, u);
    return smoothstep(0, WAVE.rise, u) * (1 + (WAVE.tip - 1) * fall);
}

// A strand's sideways offset at u: a wave travelling from the inner end to the tip as `phase` (radians)
// grows, with a faster ripple mixed in by `treble` (0..1). Never more than amplitude * envelope.
export function waveOffset(u, phase, amplitude, treble) {
    const tr = clamp01(treble) * WAVE.ripple;
    const x = 2 * Math.PI * WAVE.periods * u;
    const wave = (1 - tr) * Math.sin(x - phase) + tr * Math.sin(x * 2.3 - phase * 1.7);
    return amplitude * waveEnvelope(u) * wave;
}

// How a hand of `length` looks at band `level` (cava's 0..1) and kick `flash` (0..1,
// kicks.mjs handFlash()), with the wave scaled by `strength` (the handWaves setting) and the kick's
// whip by `whip` (its HANDS entry's):
//   amplitude  the wave's sideways reach in dial radii (0 = a straight line)
//   thicken    the factor on its plain thickness (1 = plain)
//   glow       how much neon halo it has, 0..1
//   flash      how white-hot it flashes, 0..1
export function handLook(length, level, flash = 0, strength = 1, whip = 1) {
    const l = clamp01(LOOK.boost * clamp01(level));
    const f = clamp01(flash);
    const s = Math.max(0, Number.isFinite(strength) ? strength : 1);
    return {
        amplitude: length * s * (LOOK.swing * l + LOOK.whip * whip * f),
        thicken: 1 + LOOK.thicken * l,
        glow: l,
        flash: f,
    };
}

// Each hand's pose at the local time `date`, given bass/mid/treble on cava's 0..1 scale and
// { flash, strength } (both optional): its angle (clockwise degrees from 12 o'clock, from the time
// alone), where it starts (inner) and ends (length) and its width, in dial radii, and its look.
export function handPoses(date, levels, { flash = 0, strength = 1 } = {}) {
    const angles = handAngles(date);
    const poses = {};
    for (const [name, { band, length, thickness, whip }] of Object.entries(HANDS)) {
        const look = handLook(length, levels[band], flash, strength, whip);
        // Object.assign: QML's JS engine has no object spread.
        poses[name] = Object.assign({ angle: angles[name], inner: INNER, length, width: thickness * look.thicken }, look);
    }
    return poses;
}

// The Lock Ring's hands, apart from drawing: where they point and how they look. Each hand shows
// one band: it thickens, glows and shimmers along its length with that band's level, and the
// music never touches its angle. Plain JS for tests/lock-hands.test.mjs; LockRing.qml draws it.
//
// Every parameter of the hands' look is here, in HANDS and LOOK.
import { handAngles } from "./clock.mjs";

// Each hand: the band it shows, its color (Catppuccin Mocha, as in shaders/viz.frag), and its
// plain shape in silence: length as a fraction of the dial radius, thickness as a fraction of the
// widget's size.
export const HANDS = {
    hour: { band: "bass", color: "#b4befe", length: 0.52, thickness: 0.024 },
    minute: { band: "mid", color: "#cba6f7", length: 0.78, thickness: 0.016 },
    second: { band: "treble", color: "#f5c2e7", length: 0.88, thickness: 0.007 },
};

// How strongly the hands react, at a band level of 1 (cava's full scale), and how that's drawn.
export const LOOK = {
    thicken: 1.2,       // the hand gets this much thicker than plain (1.2 = 2.2x)
    glow: 1,            // halo strength around the hand, 0..1
    shimmer: 1,         // strength of the bright wave running along the hand, 0..1
    // Drawing (LockRing.qml):
    glowSpread: 2,      // the halo's width beyond the hand, in hand thicknesses
    glowOpacity: 0.6,   // the halo's opacity at full glow
    glowBlur: 24,       // the halo's blur radius in pixels
    shimmerSpeed: 0.9,  // waves per second, from the hub to the tip
    shimmerWidth: 0.18, // half the wave's length, as a fraction of the hand
    shimmerWhite: 0.75, // how far the wave whitens the hand at full shimmer
};

// How a hand looks at band `level` (0..1): thicken is the factor on its plain thickness (1 =
// plain), glow and shimmer run from 0 (none) to LOOK's maximum.
export function handLook(level) {
    const l = Math.min(1, Math.max(0, level || 0));
    return { thicken: 1 + LOOK.thicken * l, glow: LOOK.glow * l, shimmer: LOOK.shimmer * l };
}

// Each hand's pose at the local time `date`, given bass/mid/treble on cava's 0..1 scale: its
// angle (clockwise degrees from 12 o'clock, from the time alone) and its look.
export function handPoses(date, levels) {
    const angles = handAngles(date);
    const poses = {};
    for (const [name, { band }] of Object.entries(HANDS))
        // Object.assign: QML's JS engine has no object spread.
        poses[name] = Object.assign({ angle: angles[name] }, handLook(levels[band]));
    return poses;
}

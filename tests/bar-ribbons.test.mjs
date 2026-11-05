// The Bar Visualizer's Ribbons, outside the shader: where each of the three Ribbons sits at any x
// across the bar, from the inputs shaders/viz.frag gets. Lyric Words ride them, so this has to be
// where the shader draws them. Expected heights are worked out by hand from the shader's formula.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ribbonColor, ribbonHeight, shockwaveCrossing } from "../docs/bar-ribbons.mjs";

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? ""} ${actual} != ${expected}`);

// An 800 x 40 bar: its center at x = 400, 10 bar-heights to either edge.
const BAR = { width: 800, height: 40 };
const bands = level => Array(32).fill(level);
const quiet = { ...BAR, values: bands(0), time: 0, kick: 0, treble: 0, flow: 0, bassStretch: 1, kickAges: [], kickPowers: [] };
const loud = { ...quiet, values: bands(1) };

// Heights are shares of the bar's thickness from its top edge, like qt_TexCoord0.y.
describe("the bar's Ribbons", () => {
    test("lie flat along the middle of the bar in silence", () => {
        for (const x of [0, 123, 400, 650, 800])
            for (const strand of [0, 1, 2])
                near(ribbonHeight(x, strand, quiet), 0.5, `x ${x} strand ${strand}:`);
    });

    test("start out of the bar's center each at its own phase", () => {
        near(ribbonHeight(400, 0, loud), 0.5);
        near(ribbonHeight(400, 1, loud), 0.137452, "strand 1, 0.5 + 0.42 sin(-2.1):");
        near(ribbonHeight(400, 2, loud), 0.866062, "strand 2, 0.5 + 0.42 sin(-4.2):");
    });

    test("wave with the spectrum's level, the same on both sides of the center", () => {
        // Half a bar-height out: 0.5 + 0.42 * amp * sin(0.5 * 2.6), amp = 1.3 * level capped at 1.
        near(ribbonHeight(420, 0, loud), 0.904694);
        near(ribbonHeight(380, 0, loud), 0.904694);
        near(ribbonHeight(420, 0, { ...quiet, values: bands(0.5) }), 0.763052);
    });

    test("carry a treble ripple", () => {
        // wave = sin(1.3) + 0.3 * sin(1.3 * 2.3) * treble
        near(ribbonHeight(420, 0, { ...loud, treble: 1 }), 0.923722);
    });

    test("travel outward as the flow advances", () => {
        // flow 1: sin(0.5 * 2.6 - 1)
        near(ribbonHeight(420, 0, { ...loud, flow: 1 }), 0.5 + 0.42 * 0.295520);
    });

    test("spread the bass over more of the bar with bassStretch", () => {
        // Bands rising 0..1, halfway to the edge (x = 600, 5 bar-heights out): level 0.5 ** 2.
        const rising = Array.from({ length: 32 }, (_, i) => i / 31);
        near(ribbonHeight(600, 0, { ...quiet, values: rising, bassStretch: 2 }), 0.557353);
    });

    test("surge where a Shockwave's front passes", () => {
        // A fresh full-power Shockwave at the center lifts the level there by 0.6, even in silence.
        near(ribbonHeight(400, 1, { ...quiet, kickAges: [0], kickPowers: [1] }), 0.282471);
        // An empty slot (power 0) does nothing.
        near(ribbonHeight(400, 1, { ...quiet, kickAges: [0], kickPowers: [0] }), 0.5);
    });

    test("shake with the bar on a Kick", () => {
        // kick 1 at time 0 shakes the picture up by 0.12 of the bar.
        near(ribbonHeight(400, 0, { ...loud, kick: 1 }), 0.38);
        near(ribbonHeight(400, 0, { ...quiet, kick: 1 }), 0.38);
    });
});

// A Ribbon's color, as viz.frag picks it: the palette (lavender, mauve, lavender, pink, lavender,
// blue) cycled by the clock, along the bar, by strand and with the level, deepened (each channel to
// the power 2.35). Lyric Words glow in it. Expected colors are the palette's own, deepened by hand.
describe("the bar's Ribbon colors", () => {
    const nearColor = (actual, expected, msg) => expected.forEach((c, i) => near(actual[i], c, `${msg ?? ""} channel ${i}:`));
    const MAUVE = [0.584986, 0.364683, 0.928669], PINK = [0.910752, 0.526325, 0.79296], BLUE = [0.231974, 0.441256, 0.953633];

    test("cycle through the palette with the clock", () => {
        // At the center the hue is 0.04 (10 bar-heights times 0.004), plus 0.05 a second.
        nearColor(ribbonColor(400, 0, { ...quiet, time: (1 / 6 - 0.04) / 0.05 }), MAUVE);
    });

    test("each strand a third of the palette on", () => {
        nearColor(ribbonColor(400, 1, { ...quiet, time: (1 / 2 - 0.04 - 0.33) / 0.05 }), PINK);
    });

    test("shift along the bar, outward from the center", () => {
        // At the right edge: 20 * 0.004 along it, 0.6 for being at the edge.
        nearColor(ribbonColor(800, 0, { ...quiet, time: (5 / 6 - 0.68) / 0.05 }), BLUE);
    });

    test("shift with the level", () => {
        nearColor(ribbonColor(400, 0, { ...loud, time: (1 / 2 - 0.04 - 0.2) / 0.05 }), PINK);
    });
});

// How brightly a Shockwave's front is crossing a spot on the bar, 0..1: what makes Lyric Words
// flare and split. The fronts ease out from the center to both edges.
describe("a Shockwave crossing the bar", () => {
    test("crosses the center at full strength as it is born", () => {
        near(shockwaveCrossing(400, { ...quiet, kickAges: [0], kickPowers: [1] }), 1);
        near(shockwaveCrossing(400, { ...quiet, kickAges: [0], kickPowers: [0.5] }), 0.5);
    });

    test("hasn't reached the edges yet as it is born", () => {
        near(shockwaveCrossing(800, { ...quiet, kickAges: [0], kickPowers: [1] }), 0);
    });

    test("crosses farther out later, fainter, on both sides alike", () => {
        // The front is 0.9 of the way out after ln(10) / 4.5 s, faded to e^(-2.2 * that).
        const late = { ...quiet, kickAges: [Math.log(10) / 4.5], kickPowers: [1] };
        near(shockwaveCrossing(760, late), 0.324423);
        near(shockwaveCrossing(40, late), 0.324423);
        near(shockwaveCrossing(400, late), 0, "long past the center:");
    });

    test("takes the brightest of overlapping Shockwaves; an empty slot does nothing", () => {
        near(shockwaveCrossing(400, { ...quiet, kickAges: [0, 0, 5], kickPowers: [0.6, 0.8, 0] }), 0.8);
        near(shockwaveCrossing(400, { ...quiet, kickAges: [0], kickPowers: [0] }), 0);
        near(shockwaveCrossing(400, quiet), 0);
    });
});

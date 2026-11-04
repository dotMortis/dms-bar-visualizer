// The Lock Ring's numbers live once, in the plain-JS modules (docs/lock-ring/*.mjs). The shader
// can't import them, so ring.frag repeats them; LockRing.qml and the demo import them. These
// checks keep every copy on its source, like the KICKS check in lock-kicks.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { DIAL } from "../docs/demo.mjs";
import { WAVE } from "../lock-ring/hands.mjs";
import {
    CROSSING_LEAD, CROSSING_TRAIL, KICK_FADE, KICK_GROW, KICK_ORIGIN, MAX_REACH, PLAYED_OUT, SURGE_LIFT, SURGE_WIDTH,
} from "../lock-ring/kicks.mjs";
import { DIAL_RATIO, IDLE, RIBBON } from "../lock-ring/ring.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

// ring.frag's `const float NAME = expr;` lines, evaluated in order (an expression may use the
// constants above it).
function shaderConstants() {
    const values = {};
    for (const [, name, expr] of read("lock-ring/shaders/ring.frag").matchAll(/^const float (\w+) = ([^;]+);/gm)) {
        const js = expr.replace(/[A-Z_][A-Z0-9_]*/g, id => {
            assert.ok(id in values, `${name} uses ${id} before it's defined`);
            return String(values[id]);
        });
        assert.match(js, /^[\d.\s+\-*/()e]+$/, `${name} = ${expr} is plain arithmetic`);
        values[name] = Function(`return (${js});`)();
    }
    return values;
}

const close = (actual, expected, name) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${name}: ring.frag has ${actual}, the module ${expected}`);

describe("ring.frag's constants match their modules", () => {
    const frag = shaderConstants();

    test("the dial's size in the widget (ring.mjs DIAL_RATIO)", () => {
        close(frag.DIAL_RATIO, DIAL_RATIO, "DIAL_RATIO");
    });

    test("where a shockwave starts and how far it reaches (kicks.mjs)", () => {
        close(frag.KICK_ORIGIN, KICK_ORIGIN, "KICK_ORIGIN");
        close(frag.MAX_REACH, MAX_REACH, "MAX_REACH");
    });

    test("how fast a shockwave grows and fades, and when it has played out (kicks.mjs kickAt())", () => {
        close(frag.KICK_GROW, KICK_GROW, "KICK_GROW");
        close(frag.KICK_FADE, KICK_FADE, "KICK_FADE");
        close(frag.PLAYED_OUT, PLAYED_OUT, "PLAYED_OUT");
    });

    test("how near a shockwave's front a radius feels it crossing (kicks.mjs shockwaveCrossing())", () => {
        close(frag.CROSSING_LEAD, CROSSING_LEAD, "CROSSING_LEAD");
        close(frag.CROSSING_TRAIL, CROSSING_TRAIL, "CROSSING_TRAIL");
    });

    test("how the ribbons surge where a shockwave crosses them (kicks.mjs ribbonSurge())", () => {
        close(frag.SURGE_WIDTH, SURGE_WIDTH, "SURGE_WIDTH");
        close(frag.SURGE_LIFT, SURGE_LIFT, "SURGE_LIFT");
    });

    test("the ribbon's idle wave (ring.mjs IDLE)", () => {
        for (const [key, value] of Object.entries(IDLE))
            close(frag[`IDLE_${key.toUpperCase()}`], value, `IDLE_${key.toUpperCase()}`);
    });

    test("the ribbon's music wave (ring.mjs RIBBON)", () => {
        for (const [key, value] of Object.entries(RIBBON))
            close(frag[`RIBBON_${key.toUpperCase()}`], value, `RIBBON_${key.toUpperCase()}`);
    });

    test("the hands' wave (hands.mjs WAVE)", () => {
        for (const [key, value] of Object.entries(WAVE))
            close(frag[`WAVE_${key.toUpperCase()}`], value, `WAVE_${key.toUpperCase()}`);
    });

    // hands.mjs PHASE_WRAP is seamless only for these strand multiples (tests/lock-hands.test.mjs).
    test("the hands' strands run at their hand's phase times 1, 1.5 and 2", () => {
        assert.match(read("lock-ring/shaders/ring.frag"), /float phase = wave \* \(1\.0 \+ 0\.5 \* fk\)/);
    });

    // ring.mjs hourPoints(): they flash with the shockwave crossing their radius, not the hands' flash.
    test("the hour points flash by the shockwave crossing them", () => {
        const frag = read("lock-ring/shaders/ring.frag").replace(/\/\/.*$/gm, "");
        const points = frag.slice(frag.indexOf("for (int i = 0; i < 12; i++)"), frag.indexOf("col = col / (1.0"));
        assert.match(points, /shockwaveCrossing\(/);
        assert.doesNotMatch(points, /handFlash/);
    });

    // ring.mjs hourPoints(): they ride the ribbon, surged at its rest radius as the ribbons are.
    test("the ribbons and the hour points surge alike, at the ribbon's rest radius", () => {
        const frag = read("lock-ring/shaders/ring.frag").replace(/\/\/.*$/gm, "");
        const main = frag.slice(frag.indexOf("void main()"));
        const points = main.slice(main.indexOf("for (int i = 0; i < 12; i++)"), main.indexOf("col = col / (1.0"));
        assert.match(main.slice(0, main.indexOf("for (int k = 0; k < 3; k++)")), /ribbonSurge\(base\)/);
        assert.match(points, /\+ surge\)/);
    });

    // A Shockwave hits without shaking the ring: nothing offsets where the shader draws.
    test("nothing shakes", () => {
        const frag = read("lock-ring/shaders/ring.frag").replace(/\/\/.*$/gm, "");
        assert.doesNotMatch(frag, /shake/i);
        assert.match(frag, /vec2 p = qt_TexCoord0 \* 2\.0 - 1\.0;/);
    });

    test("ring.frag spells out no other copy of the dial ratio", () => {
        const code = read("lock-ring/shaders/ring.frag").replace(/\/\/.*$/gm, "");
        assert.equal(code.match(/0\.34\b/g)?.length, 1, "only in DIAL_RATIO");
    });
});

describe("the plugin and the demo take the dial's size from ring.mjs", () => {
    test("LockRing.qml sizes the dial with DIAL_RATIO", () => {
        const qml = read("lock-ring/LockRing.qml");
        assert.match(qml, /dialRadius: size \* Ring\.DIAL_RATIO/);
        assert.doesNotMatch(qml.replace(/\/\/.*$/gm, ""), /0\.34\b/);
    });

    test("the demo's dial uniform is DIAL_RATIO of the widget, as a share of half of it", () => {
        close(DIAL, DIAL_RATIO / 0.5, "DIAL");
        for (const file of ["docs/demo.mjs", "docs/index.html"])
            assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, ""), /0\.34\b/, file);
    });
});

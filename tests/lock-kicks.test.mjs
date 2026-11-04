// Kicks on the Lock Ring: each one sends a chromatic shockwave out of the center hub, sparks fly
// off the ring, and the hands flash. Distances are in dial radii (1 = the dial), ages in seconds.
// Power is the shared detector's hit strength, 0.5 (a soft hit) to 1 (the hardest next to the
// recent kicks).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { HUB, EDGE, KICKS, handFlash, kickAt, kickSlots } from "../lock-ring/kicks.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("shockwave", () => {
    test("starts at the center hub", () => {
        assert.equal(kickAt(0, 1).front, HUB);
        assert.equal(kickAt(0, 0.5).front, HUB);
    });

    test("expands outward as it ages", () => {
        let last = -1;
        for (let age = 0; age <= 2; age += 0.05) {
            const { front } = kickAt(age, 0.8);
            assert.ok(front > last, `front ${front} at ${age} s`);
            last = front;
        }
    });

    test("a harder hit makes a bigger shockwave", () => {
        for (const age of [0.05, 0.2, 0.5, 1, 2])
            assert.ok(kickAt(age, 1).front > kickAt(age, 0.5).front * 1.3, `at ${age} s`);
        assert.ok(kickAt(0.1, 1).strength > kickAt(0.1, 0.5).strength, "and a brighter one");
    });

    test("the hardest hit passes the dial but stays inside the widget", () => {
        const { front } = kickAt(10, 1);
        assert.ok(front > 1.1, `front ${front}`);
        assert.ok(front < EDGE, `front ${front}, edge ${EDGE}`);
    });

    test("a soft hit still reaches past the hands", () => {
        assert.ok(kickAt(10, 0.5).front > 0.6);
    });

    test("fades out within two seconds", () => {
        assert.ok(kickAt(0, 1).strength >= 0.99);
        assert.ok(kickAt(2, 1).strength < 0.02);
    });
});

// The shared pipeline keeps the last 8 kicks (LockAudio.kickAges/kickPowers/kickSeeds); the ring
// shader draws every one of them, so overlapping kicks play together.
describe("kick slots", () => {
    test("all 8 of the pipeline's kicks reach the shader, in their slots", () => {
        const ages = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
        const powers = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 0.55, 0.65];
        const seeds = [9, 10, 11, 12, 5, 6, 7, 8];
        assert.deepEqual(kickSlots(ages, powers, seeds), { ages, powers, seeds });
    });

    test("before the pipeline runs, every slot is empty", () => {
        const { ages, powers, seeds } = kickSlots([], [], []);
        assert.equal(ages.length, KICKS);
        assert.deepEqual(powers, new Array(KICKS).fill(0), "power 0 = empty slot");
        assert.deepEqual(seeds, new Array(KICKS).fill(0));
        assert.ok(ages.every(a => a >= 10), "and long over");
    });

    test("a slot without a usable value is empty, not NaN", () => {
        const { ages, powers } = kickSlots([0.1, undefined, NaN], [1, 0.8, 0.9], [1, 2, 3]);
        assert.deepEqual(powers.slice(0, 3), [1, 0, 0]);
        assert.ok(ages.every(Number.isFinite));
    });

    test("a kick that has played out is an empty slot, so silence draws nothing", () => {
        const { powers } = kickSlots([2.9, 3, 50], [1, 1, 1], [1, 2, 3]);
        assert.deepEqual(powers.slice(0, 3), [1, 0, 0]);
        assert.ok(kickAt(3, 1).strength < 0.01 && kickAt(3, 1).sparkLife < 0.01, "nothing left to see by then");
    });

    test("the shader and the pipeline both have 8 slots", () => {
        assert.equal(KICKS, 8);
        const frag = fs.readFileSync(path.join(ROOT, "lock-ring/shaders/ring.frag"), "utf8");
        assert.match(frag, /^const int KICKS = 8;/m);
        const pipeline = fs.readFileSync(path.join(ROOT, "audio/AudioPipeline.qml"), "utf8");
        assert.match(pipeline, /readonly property int kickSlots: 8\b/);
    });
});

describe("sparks", () => {
    test("start on the ring and fly outward", () => {
        assert.equal(kickAt(0, 1).sparks, 1);
        let last = 1;
        for (let age = 0.05; age <= 2; age += 0.05) {
            const { sparks } = kickAt(age, 0.8);
            assert.ok(sparks > last, `sparks ${sparks} at ${age} s`);
            last = sparks;
        }
    });

    test("fly farther on a harder hit, but stay inside the widget", () => {
        assert.ok(kickAt(0.3, 1).sparks > kickAt(0.3, 0.5).sparks);
        assert.ok(kickAt(10, 1).sparks < EDGE);
    });

    test("burn out within two seconds", () => {
        assert.ok(kickAt(0, 0.7).sparkLife > 0.6);
        assert.ok(kickAt(2, 1).sparkLife < 0.03);
    });
});

// One value, 0..1, that all three hands brighten by.
describe("hand flash", () => {
    const empty = new Array(KICKS).fill(0);
    const one = (age, power) => [[age, ...new Array(KICKS - 1).fill(100)], [power, ...empty.slice(1)]];

    test("is dark without kicks", () => {
        assert.equal(handFlash([], []), 0);
        assert.equal(handFlash(new Array(KICKS).fill(100), empty), 0);
    });

    test("lights up the moment a kick fires, brighter for a harder hit", () => {
        assert.equal(handFlash(...one(0, 1)), 1);
        assert.equal(handFlash(...one(0, 0.5)), 0.5);
    });

    test("fires together with the shockwave and the sparks, from the same kick", () => {
        for (const power of [0.5, 0.75, 1]) {
            const kick = kickAt(0, power);
            assert.ok(kick.strength > 0 && kick.sparkLife > 0 && handFlash(...one(0, power)) > 0, `power ${power}`);
        }
    });

    test("is a flash, gone within 0.4 s at the default kickDecay", () => {
        assert.ok(handFlash(...one(0.4, 1)) < 0.1);
    });

    test("a higher kickDecay makes it shorter", () => {
        assert.ok(handFlash(...one(0.1, 1), 12) < handFlash(...one(0.1, 1), 6));
    });

    test("overlapping kicks: a new hit flashes again, and it never goes past full", () => {
        const ages = [0.3, 0, 0.05, ...new Array(KICKS - 3).fill(100)];
        const powers = [1, 0.6, 1, ...empty.slice(3)];
        const flash = handFlash(ages, powers);
        assert.ok(flash >= 0.6 && flash <= 1, `flash ${flash}`);
    });
});

// The Lock Ring's hands: each one shows its own band (hour = bass, minute = mids, second = highs)
// by thickening, glowing and shimmering, and the music never moves them off the true time.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handPoses } from "../lock-ring/hands.mjs";

// Local wall-clock time on 2026-11-04.
const at = (h, m, s = 0, ms = 0) => new Date(2026, 10, 4, h, m, s, ms);
const silence = { bass: 0, mid: 0, treble: 0 };

describe("hands in silence", () => {
    test("are plain: base thickness, no glow, no shimmer", () => {
        for (const [name, hand] of Object.entries(handPoses(at(10, 10), silence))) {
            assert.equal(hand.thicken, 1, `${name} thicken`);
            assert.equal(hand.glow, 0, `${name} glow`);
            assert.equal(hand.shimmer, 0, `${name} shimmer`);
        }
    });
});

describe("each hand shows its own band", () => {
    const bands = { hour: "bass", minute: "mid", second: "treble" };

    for (const [name, band] of Object.entries(bands)) {
        test(`the ${name} hand thickens, glows and shimmers with the ${band} alone`, () => {
            const poses = handPoses(at(10, 10), { ...silence, [band]: 0.7 });
            assert.ok(poses[name].thicken > 1, `thicken ${poses[name].thicken}`);
            assert.ok(poses[name].glow > 0, `glow ${poses[name].glow}`);
            assert.ok(poses[name].shimmer > 0, `shimmer ${poses[name].shimmer}`);
            for (const other of Object.keys(bands).filter(n => n !== name))
                assert.deepEqual(
                    { ...poses[other], angle: 0 },
                    { angle: 0, thicken: 1, glow: 0, shimmer: 0 },
                    `${other} stays plain`);
        });
    }

    test("louder makes a hand thicker, brighter and shimmer more, up to a cap at full scale", () => {
        const look = bass => handPoses(at(10, 10), { ...silence, bass }).hour;
        const quiet = look(0.2), loud = look(0.8), full = look(1), over = look(1.5);
        for (const key of ["thicken", "glow", "shimmer"]) {
            assert.ok(loud[key] > quiet[key], `${key}: loud ${loud[key]}, quiet ${quiet[key]}`);
            assert.equal(over[key], full[key], `${key} is capped`);
        }
        // Thicker, but still a hand: at most a few times its plain thickness.
        assert.ok(full.thicken > 1.5 && full.thicken <= 3, `thicken ${full.thicken}`);
        assert.ok(full.glow <= 1 && full.shimmer <= 1);
    });
});

describe("the music never moves the hands", () => {
    const loud = { bass: 1, mid: 0.9, treble: 0.8 };

    test("at 3:00:00 in loud music the hour hand points at 3 and the others at 12", () => {
        const poses = handPoses(at(3, 0), loud);
        assert.deepEqual([poses.hour.angle, poses.minute.angle, poses.second.angle], [90, 0, 0]);
    });

    test("at 9:30:15.5 the angles are the same in silence, quiet and loud music", () => {
        const angles = levels => {
            const p = handPoses(at(9, 30, 15, 500), levels);
            return [p.hour.angle, p.minute.angle, p.second.angle];
        };
        const expected = [285 + 15.5 / 120, 180 + 15.5 / 10, 93];
        for (const levels of [silence, { bass: 0.3, mid: 0.2, treble: 0.1 }, loud, { bass: 5, mid: -1, treble: NaN }]) {
            const got = angles(levels);
            for (let i = 0; i < 3; i++)
                assert.ok(Math.abs(got[i] - expected[i]) < 1e-9, `${JSON.stringify(levels)}: ${got} vs ${expected}`);
        }
    });
});

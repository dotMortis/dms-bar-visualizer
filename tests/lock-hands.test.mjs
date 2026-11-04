// The Lock Ring's hands: each one is a wave ribbon showing its own band (hour = bass, minute =
// mids, second = highs). The band swings, thickens and lights it, every Kick whips it, and the
// music never moves it off the true time.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HANDS, handPoses, waveEnvelope, waveOffset } from "../lock-ring/hands.mjs";

// Local wall-clock time on 2026-11-04.
const at = (h, m, s = 0, ms = 0) => new Date(2026, 10, 4, h, m, s, ms);
const silence = { bass: 0, mid: 0, treble: 0 };
// What music and kicks change about a hand.
const lookOf = ({ amplitude, thicken, glow, flash }) => ({ amplitude, thicken, glow, flash });
const PLAIN = { amplitude: 0, thicken: 1, glow: 0, flash: 0 };

describe("hands in silence", () => {
    test("are calm, plain lines: no wave, base thickness, no glow", () => {
        for (const [name, hand] of Object.entries(handPoses(at(10, 10), silence)))
            assert.deepEqual(lookOf(hand), PLAIN, name);
    });

    test("keep their own length and plain thickness", () => {
        const poses = handPoses(at(10, 10), silence);
        for (const [name, spec] of Object.entries(HANDS)) {
            assert.equal(poses[name].length, spec.length, `${name} length`);
            assert.equal(poses[name].width, spec.thickness, `${name} width`);
        }
    });
});

describe("each hand shows its own band", () => {
    const bands = { hour: "bass", minute: "mid", second: "treble" };

    for (const [name, band] of Object.entries(bands)) {
        test(`the ${name} hand swings, thickens and glows with the ${band} alone`, () => {
            const poses = handPoses(at(10, 10), { ...silence, [band]: 0.7 });
            assert.ok(poses[name].amplitude > 0, `amplitude ${poses[name].amplitude}`);
            assert.ok(poses[name].thicken > 1, `thicken ${poses[name].thicken}`);
            assert.ok(poses[name].glow > 0, `glow ${poses[name].glow}`);
            for (const other of Object.keys(bands).filter(n => n !== name))
                assert.deepEqual(lookOf(poses[other]), PLAIN, `${other} stays plain`);
        });
    }

    test("louder makes a hand swing wider, thicker and brighter, up to a cap at full scale", () => {
        const look = bass => handPoses(at(10, 10), { ...silence, bass }).hour;
        const quiet = look(0.2), loud = look(0.7), full = look(1), over = look(1.5);
        for (const key of ["amplitude", "thicken", "glow"]) {
            assert.ok(loud[key] > quiet[key], `${key}: loud ${loud[key]}, quiet ${quiet[key]}`);
            assert.equal(over[key], full[key], `${key} is capped`);
        }
    });

    // Impactful but slim, like the bar's neon ribbons: the impact is the swing and the glow, not
    // the thickness.
    test("at full scale a hand swings by a tenth of its length, glows fully and stays slim", () => {
        for (const [name, band] of Object.entries(bands)) {
            const hand = handPoses(at(10, 10), { ...silence, [band]: 1 })[name];
            assert.ok(hand.amplitude >= 0.1 * hand.length, `${name} amplitude ${hand.amplitude}`);
            assert.equal(hand.glow, 1, `${name} glow`);
            assert.ok(hand.thicken > 1 && hand.thicken <= 1.3, `${name} thicken ${hand.thicken}`);
            assert.ok(hand.width <= 1.3 * HANDS[name].thickness + 1e-12, `${name} width ${hand.width}`);
        }
    });

    test("every hand is slim: thinner than a twentieth of the dial", () => {
        for (const [name, { thickness }] of Object.entries(HANDS))
            assert.ok(thickness < 0.05, `${name} ${thickness}`);
    });
});

describe("every Kick whips the hands", () => {
    test("a kick swings even a silent hand and flashes it", () => {
        for (const [name, hand] of Object.entries(handPoses(at(10, 10), silence, { flash: 1 }))) {
            assert.ok(hand.amplitude > 0, `${name} amplitude`);
            assert.equal(hand.flash, 1, `${name} flash`);
        }
    });

    test("a full kick at least doubles the long hands' swing at half scale, and adds half to the hour's", () => {
        const half = { bass: 0.5, mid: 0.5, treble: 0.5 };
        const calm = handPoses(at(10, 10), half), kicked = handPoses(at(10, 10), half, { flash: 1 });
        for (const name of ["minute", "second"])
            assert.ok(kicked[name].amplitude >= 2 * calm[name].amplitude, name);
        assert.ok(kicked.hour.amplitude >= 1.5 * calm.hour.amplitude, "hour");
    });

    // The short hour hand gets busy if it whips as hard as the long ones.
    test("the hour hand whips less than the others, for its length", () => {
        const kicked = handPoses(at(10, 10), silence, { flash: 1 });
        const share = name => kicked[name].amplitude / kicked[name].length;
        assert.ok(share("hour") < share("minute") && share("hour") < share("second"));
        assert.ok(share("hour") > 0, "but it still whips");
    });

    test("the whip fades with the flash", () => {
        const swing = flash => handPoses(at(10, 10), silence, { flash }).minute.amplitude;
        assert.ok(swing(1) > swing(0.4) && swing(0.4) > swing(0));
    });
});

describe("wave strength", () => {
    test("scales the swing, and at 0 the hands stay straight", () => {
        const loud = { bass: 1, mid: 1, treble: 1 };
        const swing = strength => handPoses(at(10, 10), loud, { flash: 1, strength }).hour;
        assert.equal(swing(0).amplitude, 0);
        assert.ok(Math.abs(swing(2).amplitude - 2 * swing(1).amplitude) < 1e-12);
        assert.equal(swing(0).thicken, swing(1).thicken, "thickness is the band's, not the wave's");
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

// Floating hands: none of them reaches the center, so they never meet there. Each still lies on
// the line through the center at its clock angle.
describe("the hands float", () => {
    test("every hand starts a small gap out from the center and runs out to its length", () => {
        const poses = handPoses(at(10, 10), { bass: 1, mid: 1, treble: 1 }, { flash: 1 });
        for (const [name, hand] of Object.entries(poses)) {
            assert.ok(hand.inner >= 0.08 && hand.inner <= 0.12, `${name} inner ${hand.inner}`);
            assert.ok(hand.length - hand.inner > 0.3, `${name} runs out from there`);
        }
    });

    test("the gap is wider than any hand, so they never touch at the center", () => {
        const poses = handPoses(at(10, 10), { bass: 1, mid: 1, treble: 1 });
        for (const [name, hand] of Object.entries(poses))
            assert.ok(hand.inner > 2 * hand.width, `${name}: gap ${hand.inner}, width ${hand.width}`);
    });
});

// The wave only ever bends a hand sideways around its straight axis at the true angle: it starts
// at the hand's inner end and leaves the tip on (or just beside) the axis, so the hand still
// reads. u runs along the hand, 0 at its inner end to 1 at the tip.
describe("the wave bends a hand around its axis", () => {
    test("there is no bend at the hand's inner end", () => {
        assert.equal(waveEnvelope(0), 0);
        for (const phase of [0, 0.3, 1.7, 5])
            assert.equal(Math.abs(waveOffset(0, phase, 0.3, 1)), 0, `phase ${phase}`);
    });

    test("the bend is full along the middle of the hand and small at the tip", () => {
        assert.equal(waveEnvelope(0.5), 1);
        assert.ok(waveEnvelope(1) > 0 && waveEnvelope(1) <= 0.15, `tip ${waveEnvelope(1)}`);
        for (let u = 0; u <= 1; u += 0.01)
            assert.ok(waveEnvelope(u) >= 0 && waveEnvelope(u) <= 1, `envelope at ${u}`);
    });

    test("the wave never pushes a point further aside than the amplitude allows there", () => {
        for (let u = 0; u <= 1; u += 0.02)
            for (let phase = 0; phase < 7; phase += 0.37)
                for (const treble of [0, 1])
                    assert.ok(Math.abs(waveOffset(u, phase, 0.2, treble)) <= 0.2 * waveEnvelope(u) + 1e-12,
                        `u ${u} phase ${phase}`);
    });

    test("even in the loudest kick at full wave strength, the tip turns a hand by at most 5 degrees", () => {
        const loud = { bass: 1, mid: 1, treble: 1 };
        for (const [name, hand] of Object.entries(handPoses(at(10, 10), loud, { flash: 1, strength: 2 }))) {
            const degrees = Math.atan2(hand.amplitude * waveEnvelope(1), hand.length) * 180 / Math.PI;
            assert.ok(degrees > 0 && degrees <= 5, `${name}: ${degrees.toFixed(2)} degrees`);
        }
    });
});

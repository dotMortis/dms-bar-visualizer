// Kicks on the Lock Ring: each one sends a chromatic shockwave out of the center and the hands
// flash. (The sparks it flings off the ring are the shader's alone.) Distances are in dial radii (1 = the dial), ages in seconds.
// Power is the shared detector's hit strength, 0.5 (a soft hit) to 1 (the hardest next to the
// recent kicks).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { TIME_RADIUS } from "../lock-ring/clock.mjs";
import { DEFAULTS } from "../docs/config.mjs";
import { KICK_ORIGIN, EDGE, KICKS, handFlash, kickAt, kickSlots, ribbonSurge, shockwaveCrossing } from "../lock-ring/kicks.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("shockwave", () => {
    test("starts at the center", () => {
        assert.equal(kickAt(0, 1).front, KICK_ORIGIN);
        assert.equal(kickAt(0, 0.5).front, KICK_ORIGIN);
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
        assert.ok(kickAt(3, 1).strength < 0.01, "nothing left to see by then");
    });

    test("the shader and the pipeline both have 8 slots", () => {
        assert.equal(KICKS, 8);
        const frag = fs.readFileSync(path.join(ROOT, "lock-ring/shaders/ring.frag"), "utf8");
        assert.match(frag, /^const int KICKS = 8;/m);
        const pipeline = fs.readFileSync(path.join(ROOT, "audio/AudioPipeline.qml"), "utf8");
        assert.match(pipeline, /readonly property int kickSlots: 8\b/);
    });
});

// One value, 0..1, that all three hands brighten by.
describe("hand flash", () => {
    const decay = DEFAULTS.kickDecay;
    const empty = new Array(KICKS).fill(0);
    const one = (age, power) => [[age, ...new Array(KICKS - 1).fill(100)], [power, ...empty.slice(1)], decay];

    test("is dark without kicks", () => {
        assert.equal(handFlash([], [], decay), 0);
        assert.equal(handFlash(new Array(KICKS).fill(100), empty, decay), 0);
    });

    test("lights up the moment a kick fires, brighter for a harder hit", () => {
        assert.equal(handFlash(...one(0, 1)), 1);
        assert.equal(handFlash(...one(0, 0.5)), 0.5);
    });

    test("fires together with the shockwave, from the same kick", () => {
        for (const power of [0.5, 0.75, 1]) {
            const kick = kickAt(0, power);
            assert.ok(kick.strength > 0 && handFlash(...one(0, power)) > 0, `power ${power}`);
        }
    });

    test("is a flash, gone within 0.4 s at the default kickDecay", () => {
        assert.ok(handFlash(...one(0.4, 1)) < 0.1);
    });

    test("a higher kickDecay makes it shorter", () => {
        assert.ok(handFlash(...one(0.1, 1).slice(0, 2), 12) < handFlash(...one(0.1, 1).slice(0, 2), 6));
    });

    test("overlapping kicks: a new hit flashes again, and it never goes past full", () => {
        const ages = [0.3, 0, 0.05, ...new Array(KICKS - 3).fill(100)];
        const powers = [1, 0.6, 1, ...empty.slice(3)];
        const flash = handFlash(ages, powers, decay);
        assert.ok(flash >= 0.6 && flash <= 1, `flash ${flash}`);
    });
});

// How brightly a shockwave's front is crossing a radius right now, 0..1: what the hour points
// light up by as the wave passes them.
describe("shockwave crossing", () => {
    const empty = new Array(KICKS).fill(0);
    const one = (age, power) => [[age, ...new Array(KICKS - 1).fill(100)], [power, ...empty.slice(1)]];

    test("is 0 with no kicks", () => {
        for (const r of [0, 0.3, 1, 1.2]) {
            assert.equal(shockwaveCrossing(r, [], []), 0);
            assert.equal(shockwaveCrossing(r, new Array(KICKS).fill(100), empty), 0);
        }
    });

    test("is 0 where the front hasn't reached yet, and peaks as the front passes", () => {
        let peak = 0, peakAge = 0;
        for (let age = 0; age <= 2; age += 0.005) {
            const value = shockwaveCrossing(1, ...one(age, 1));
            if (kickAt(age, 1).front < 0.85)
                assert.equal(value, 0, `at ${age} s, front ${kickAt(age, 1).front}`);
            if (value > peak)
                [peak, peakAge] = [value, age];
        }
        assert.ok(peak > 0.4, `peak ${peak}`);
        assert.ok(Math.abs(kickAt(peakAge, 1).front - 1) < 0.02, `peaks with the front at ${kickAt(peakAge, 1).front}`);
    });

    const peakAt = (radius, ages, powers) => {
        let peak = 0;
        for (let t = 0; t <= 3; t += 0.005)
            peak = Math.max(peak, shockwaveCrossing(radius, ages.map(a => a + t), powers));
        return peak;
    };

    test("a harder kick gives a higher peak", () => {
        for (const r of [0.3, 0.6]) {
            const soft = peakAt(r, ...one(0, 0.5)), hard = peakAt(r, ...one(0, 1));
            assert.ok(soft > 0, `a soft kick still crosses ${r}`);
            assert.ok(hard > soft * 1.3, `at ${r}: hard ${hard}, soft ${soft}`);
        }
    });

    test("overlapping shockwaves: the brightest wins, and it never goes above 1", () => {
        const ages = [0.3, 0.1, 0.05, 0, 0.02, 0.2, 0.15, 0.01];
        const powers = new Array(KICKS).fill(1);
        for (let r = 0; r <= 1.4; r += 0.01) {
            const all = shockwaveCrossing(r, ages, powers);
            const brightest = Math.max(...ages.map((age, i) => shockwaveCrossing(r, ...one(age, powers[i]))));
            assert.ok(Math.abs(all - brightest) < 1e-12, `at ${r}: ${all} vs ${brightest}`);
            assert.ok(all <= 1);
        }
    });

    test("reaches the digital time before the ring: the wave hits the time, then the ring", () => {
        // When each radius is crossed hardest by one kick, at every power.
        const peakAge = (radius, power) => {
            let peak = 0, at = 0;
            for (let age = 0; age <= 3; age += 0.002) {
                const value = shockwaveCrossing(radius, ...one(age, power));
                if (value > peak)
                    [peak, at] = [value, age];
            }
            return { peak, at };
        };
        assert.ok(TIME_RADIUS > 0.3 && TIME_RADIUS < 0.8, `the time sits inside the dial, at ${TIME_RADIUS}`);
        for (const power of [0.5, 0.75, 1]) {
            const time = peakAge(TIME_RADIUS, power);
            assert.ok(time.peak > 0, `a ${power} kick reaches the time`);
            if (power === 1) {
                const ring = peakAge(1, power);
                assert.ok(time.at < ring.at, `time at ${time.at} s, ring at ${ring.at} s`);
            }
        }
    });

    test("fades as the shockwave fades", () => {
        // A soft kick's front settles at its reach; a radius there keeps being crossed, fading out.
        const r = kickAt(10, 0.5).front;
        let last = Infinity;
        for (const age of [1, 1.5, 2, 2.5]) {
            const value = shockwaveCrossing(r, ...one(age, 0.5));
            assert.ok(value < last, `at ${age} s: ${value}`);
            last = value;
        }
        assert.ok(last < 0.01, `${last} by 2.5 s`);
        assert.equal(shockwaveCrossing(r, ...one(3, 0.5)), 0, "and nothing once it has played out");
    });
});

// How much a shockwave's front lifts the ribbons where it crosses them (spectrum level, added to
// the music's): the bar's surge, bent into a ring.
describe("ribbon surge", () => {
    const empty = new Array(KICKS).fill(0);
    const one = (age, power) => [[age, ...new Array(KICKS - 1).fill(100)], [power, ...empty.slice(1)]];
    const peakAt = (radius, ages, powers) => {
        let peak = 0;
        for (let t = 0; t <= 3; t += 0.002)
            peak = Math.max(peak, ribbonSurge(radius, ages.map(a => a + t), powers));
        return peak;
    };

    test("is 0 with no kicks", () => {
        for (const r of [0.3, 1, 1.2]) {
            assert.equal(ribbonSurge(r, [], []), 0);
            assert.equal(ribbonSurge(r, new Array(KICKS).fill(100), empty), 0);
        }
    });

    test("is 0 before the front arrives and after it has passed, and peaks as it passes", () => {
        let peak = 0, peakAge = 0;
        for (let age = 0; age <= 2; age += 0.002) {
            const value = ribbonSurge(1, ...one(age, 1));
            if (Math.abs(kickAt(age, 1).front - 1) > 0.3)
                assert.ok(value < 1e-3, `at ${age} s, front ${kickAt(age, 1).front}: ${value}`);
            if (value > peak)
                [peak, peakAge] = [value, age];
        }
        assert.ok(peak > 0.2, `peak ${peak}`);
        assert.ok(Math.abs(kickAt(peakAge, 1).front - 1) < 0.02, `peaks with the front at ${kickAt(peakAge, 1).front}`);
    });

    test("a harder kick surges more", () => {
        for (const r of [0.6, 1]) {
            const soft = peakAt(r, ...one(0, 0.7)), hard = peakAt(r, ...one(0, 1));
            assert.ok(hard > soft * 1.3, `at ${r}: hard ${hard}, soft ${soft}`);
        }
    });

    test("overlapping surges add up", () => {
        const [ages] = one(0.25, 1);
        ages[1] = 0.26;
        const powers = [1, 1, ...empty.slice(2)];
        const both = ribbonSurge(1, ages, powers);
        const first = ribbonSurge(1, ...one(0.25, 1)), second = ribbonSurge(1, ...one(0.26, 1));
        assert.ok(first > 0.05 && second > 0.05, `${first}, ${second}`);
        assert.ok(Math.abs(both - (first + second)) < 1e-12, `${both} vs ${first} + ${second}`);
    });
});

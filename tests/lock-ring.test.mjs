// The Lock Ring's look, apart from drawing: where on the ring each part of the spectrum sits, how
// the ring swells with the music and settles back into a calm, living ribbon in silence, and the
// 12 hour points riding on it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { IDLE, RIBBON, createRingMotion, hourPoints, ribbonLevel, ribbonRadius, spectrumAt, spectrumLevel } from "../lock-ring/ring.mjs";
import { kickAt, ribbonSurge, shockwaveCrossing } from "../lock-ring/kicks.mjs";

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ""} ${actual} != ${expected}`);

// Angles are clockwise degrees from 12 o'clock, like the hands. Spectrum positions run from 0
// (lowest band) to 1 (highest).
describe("spectrum around the ring", () => {
    test("bass sits at the bottom, at 6 o'clock", () => {
        near(spectrumAt(180, 1.4), 0);
    });

    test("the highs meet at the top, at 12 o'clock", () => {
        near(spectrumAt(0, 1.4), 1);
        near(spectrumAt(360, 1.4), 1);
    });

    test("left and right are mirror images", () => {
        for (const angle of [10, 45, 90, 135, 170])
            near(spectrumAt(angle, 1.4), spectrumAt(360 - angle, 1.4), `${angle} vs ${360 - angle}:`);
    });

    test("without bass stretch, 3 and 9 o'clock show the middle of the spectrum", () => {
        near(spectrumAt(90, 1), 0.5);
        near(spectrumAt(270, 1), 0.5);
    });

    test("bass stretch gives the bass more of the ring, like the bar's bassStretch", () => {
        // Halfway up the ring the spectrum is still a fifth short of its middle at 1.4.
        near(spectrumAt(90, 1.4), 0.5 ** 1.4);
    });

    test("the spectrum climbs from the bottom to the top on each side", () => {
        for (let angle = 180; angle > 0; angle -= 5)
            assert.ok(spectrumAt(angle - 5, 1.4) > spectrumAt(angle, 1.4), `right side at ${angle}`);
        for (let angle = 180; angle < 360; angle += 5)
            assert.ok(spectrumAt(angle + 5, 1.4) > spectrumAt(angle, 1.4), `left side at ${angle}`);
    });
});

// Feeds `levels` (bass, mid, treble on cava's 0..1 scale) for `seconds` at 60 fps, returning
// the last frame.
function play(motion, levels, seconds) {
    let frame;
    for (let t = 0; t < seconds; t += 1 / 60)
        frame = motion.step(levels, 1 / 60);
    return frame;
}

const silence = { bass: 0, mid: 0, treble: 0 };
const music = { bass: 0.6, mid: 0.4, treble: 0.3 };

describe("ring motion", () => {
    test("in silence the ribbon idles: no music in it, no swell", () => {
        assert.deepEqual(play(createRingMotion(), silence, 1), { swell: 0, presence: 0 });
    });

    test("when the music starts, the ribbons show within a quarter second and the ring swells", () => {
        const { swell, presence } = play(createRingMotion(), music, 0.25);
        assert.ok(presence > 0.9, `presence ${presence}`);
        assert.ok(swell > 0, `swell ${swell}`);
    });

    test("louder music swells the ring more", () => {
        const quiet = play(createRingMotion(), { bass: 0.2, mid: 0.1, treble: 0.1 }, 0.5).swell;
        const loud = play(createRingMotion(), { bass: 0.9, mid: 0.6, treble: 0.4 }, 0.5).swell;
        assert.ok(loud > quiet * 2, `loud ${loud}, quiet ${quiet}`);
    });

    test("the swell follows a beat: up on the hit and back down before the next one", () => {
        const motion = createRingMotion();
        play(motion, { bass: 0.1, mid: 0.1, treble: 0.1 }, 1);
        const before = motion.step({ bass: 0.1, mid: 0.1, treble: 0.1 }, 1 / 60).swell;
        const hit = play(motion, { bass: 1, mid: 0.4, treble: 0.2 }, 0.1).swell;
        const after = play(motion, { bass: 0.1, mid: 0.1, treble: 0.1 }, 0.4).swell;
        assert.ok(hit > before * 3, `hit ${hit}, before ${before}`);
        assert.ok(after < before * 1.2, `after ${after}, before ${before}`);
    });

    test("at full scale the ring swells by at most a tenth of the dial, so it stays in the widget", () => {
        const { swell } = play(createRingMotion(), { bass: 1, mid: 1, treble: 1 }, 2);
        assert.ok(swell > 0.05 && swell <= 0.1, `swell ${swell}`);
    });

    test("when the music stops, the ribbon is back to idling within 1.5 s", () => {
        const motion = createRingMotion();
        play(motion, music, 3);
        const { swell, presence } = play(motion, silence, 1.5);
        assert.ok(presence < 0.02, `presence ${presence}`);
        assert.ok(swell < 0.002, `swell ${swell}`);
    });
});

// The ribbon is the dial. In silence it never freezes into a fixed circle: it breathes and drifts
// slowly, thin and close to the dial radius, so the clock stays readable. Music grows it into the
// full spectrum ribbons. Radii are in dial radii (1 = the dial).
describe("the living ribbon", () => {
    const quiet = { level: 0, flow: 0, treble: 0, swell: 0 };

    test("in silence it is never a fixed circle: it changes over time and around the dial", () => {
        for (let strand = 0; strand < 3; strand++) {
            const now = ribbonRadius(30, { ...quiet, time: 10, strand });
            assert.ok(Math.abs(ribbonRadius(30, { ...quiet, time: 12, strand }) - now) > 1e-3, `strand ${strand} over time`);
            assert.ok(Math.abs(ribbonRadius(75, { ...quiet, time: 10, strand }) - now) > 1e-3, `strand ${strand} around`);
        }
    });

    test("in silence it stays calm, within a few hundredths of the dial", () => {
        for (let time = 0; time < 60; time += 0.7)
            for (let angle = 0; angle < 360; angle += 7)
                for (let strand = 0; strand < 3; strand++) {
                    const r = ribbonRadius(angle, { ...quiet, time, strand });
                    assert.ok(Math.abs(r - 1) <= IDLE.reach + 1e-12 && IDLE.reach <= 0.04, `${angle} at ${time}: ${r}`);
                }
    });

    test("it moves slowly in silence: a second changes it by less than its idle reach", () => {
        for (let time = 0; time < 30; time += 1.3) {
            const a = ribbonRadius(120, { ...quiet, time }), b = ribbonRadius(120, { ...quiet, time: time + 1 });
            assert.ok(Math.abs(b - a) < IDLE.reach, `at ${time}: ${a} -> ${b}`);
        }
    });

    test("the music grows it outward into the spectrum ribbons", () => {
        let most = 0;
        for (let angle = 0; angle < 360; angle += 3)
            most = Math.max(most, ribbonRadius(angle, { level: 1, flow: 1, treble: 0, swell: 0.08, time: 5 }));
        assert.ok(most > 1.3, `reaches ${most}`);
    });

    test("it is seamless where the shader's time wraps (1200 s)", () => {
        for (const angle of [0, 45, 200])
            for (let strand = 0; strand < 3; strand++)
                near(ribbonRadius(angle, { ...quiet, time: 1200, strand }), ribbonRadius(angle, { ...quiet, time: 0, strand }), `${angle}`);
    });
});

describe("the hour points", () => {
    const values = Array.from({ length: 32 }, (_, i) => (i % 5) / 5);
    const state = { values, flow: 2, time: 7, treble: 0.3, swell: 0.04, presence: 1, bassStretch: 1.4 };

    test("there are 12, one at every hour", () => {
        assert.deepEqual(hourPoints(state).map(p => p.angle), [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);
    });

    test("each rides on the ribbon, at the ribbon's radius at its hour", () => {
        for (const point of hourPoints(state)) {
            const level = Math.min(1, 1.3 * ribbonLevel(values, spectrumAt(point.angle, 1.4)));
            near(point.radius, ribbonRadius(point.angle, Object.assign({}, state, { level, strand: 0 })), `${point.angle}`);
        }
    });

    test("they move with the ribbon, in silence too", () => {
        const silent = Object.assign({}, state, { values: new Array(32).fill(0), presence: 0, swell: 0 });
        const now = hourPoints(silent), later = hourPoints(Object.assign({}, silent, { time: 9 }));
        assert.ok(now.some((p, i) => Math.abs(p.radius - later[i].radius) > 1e-3));
    });

    test("12, 3, 6 and 9 are brighter", () => {
        const points = hourPoints(state);
        for (const p of points)
            if (p.angle % 90 !== 0)
                assert.ok(p.glow < points[0].glow && p.glow > 0, `${p.angle}`);
        for (const i of [3, 6, 9])
            near(points[i].glow, points[0].glow);
    });

    // A hard kick, `age` seconds ago: its Shockwave crossing the ring (kicks.mjs).
    const kicked = age => Object.assign({}, state, { crossing: r => shockwaveCrossing(r, [age], [1]) });

    test("a kick doesn't flash them at its instant, while its Shockwave is still near the center", () => {
        const points = hourPoints(state);
        for (const age of [0, 0.05])
            hourPoints(kicked(age)).forEach((p, i) => near(p.glow, points[i].glow, `${p.angle} at ${age} s`));
    });

    test("each flashes as the Shockwave's front reaches its radius", () => {
        const points = hourPoints(state);
        points.forEach((p, i) => {
            let age = 0;
            while (kickAt(age, 1).front < p.radius)
                age += 0.001;
            assert.ok(hourPoints(kicked(age))[i].glow > p.glow + 0.2, `${p.angle} at ${age} s`);
        });
    });

    // A hard kick whose Shockwave's front is at the ribbon's rest radius (1 + swell): the ribbons
    // surge there.
    const surging = (() => {
        let age = 0;
        while (kickAt(age, 1).front < 1 + state.swell)
            age += 0.001;
        return Object.assign({}, state, { surge: r => ribbonSurge(r, [age], [1]) });
    })();

    // Each surges where its own strand is before the surge, as the ribbons do in ring.frag.
    test("they ride the ribbon as a Shockwave surges it, swinging farther with it", () => {
        assert.ok(surging.surge(1 + state.swell) > 0.2, `the surge at the ring: ${surging.surge(1 + state.swell)}`);
        const calm = hourPoints(state), surged = hourPoints(surging);
        surged.forEach((point, i) => {
            const lift = surging.surge(calm[i].radius);
            const level = Math.min(1, 1.3 * ribbonLevel(values, spectrumAt(point.angle, 1.4)) + lift);
            near(point.radius, ribbonRadius(point.angle, Object.assign({}, state, { level, strand: 0 })), `${point.angle}`);
        });
        // The points the front is crossing swing farther; the ones it is far from stay put.
        const swing = p => Math.abs(p.radius - 1 - state.swell);
        assert.ok(surged.some((p, i) => swing(p) > swing(calm[i]) + 0.01), "a point the front crosses swings farther");
        surged.forEach((p, i) => {
            if (surging.surge(calm[i].radius) < 1e-3)
                near(p.radius, calm[i].radius, `${p.angle}, which the front is far from`);
        });
    });

    test("they stay visible in silence, a little dimmer", () => {
        const silent = hourPoints(Object.assign({}, state, { presence: 0 }));
        silent.forEach((p, i) => assert.ok(p.glow > 0.3 * hourPoints(state)[i].glow && p.glow < hourPoints(state)[i].glow));
    });
});

describe("the spectrum level", () => {
    test("interpolates the 32 bands, bass first", () => {
        const values = Array.from({ length: 32 }, (_, i) => i / 31);
        near(spectrumLevel(values, 0), 0);
        near(spectrumLevel(values, 1), 1);
        near(spectrumLevel(values, 0.5), 0.5);
    });
});

// The slope of f at x, from the left and from the right.
const slopes = (f, x, h = 1e-7) => [(f(x) - f(x - h)) / h, (f(x + h) - f(x)) / h];

describe("the smoothed spectrum", () => {
    // Uneven bands, with peaks and dips next to each other and at both ends.
    const values = Array.from({ length: 32 }, (_, i) => [0.9, 0.1, 0.6, 1, 0, 0.35, 0.8][i % 7]);

    test("passes through every band's value", () => {
        values.forEach((v, i) => near(spectrumLevel(values, i / 31), v, `band ${i}:`));
    });

    test("stays within 0..1 between the bands", () => {
        for (let s = 0; s <= 1; s += 1 / 3100) {
            const level = spectrumLevel(values, s);
            assert.ok(level >= 0 && level <= 1, `${s}: ${level}`);
        }
    });

    test("has no slope jump where one band meets the next", () => {
        for (let i = 1; i < 31; i++) {
            const [left, right] = slopes(s => spectrumLevel(values, s), i / 31);
            assert.ok(Math.abs(left - right) < 0.01, `band ${i}: ${left} vs ${right}`);
        }
    });
});

// With music the ribbons wave like the bar's, but only outward: each strand rises from the
// swelling dial and back down to it, never inside it, so the clock keeps its room.
describe("the ribbon with music", () => {
    const playing = { flow: 1.3, time: 5, treble: 0.3, swell: 0.06 };
    const span = (level, strand) => {
        let low = Infinity, high = -Infinity;
        for (let angle = 0; angle < 360; angle += 0.5) {
            const r = ribbonRadius(angle, { ...playing, level, strand });
            low = Math.min(low, r);
            high = Math.max(high, r);
        }
        return { low, high };
    };

    test("swings only outward from the swollen dial, beyond its idle wave, never inside it", () => {
        const base = 1 + playing.swell;
        for (const treble of [0, 0.5, 1])
            for (let strand = 0; strand < 3; strand++) {
                let low = Infinity, high = -Infinity;
                for (let angle = 0; angle < 360; angle += 0.5)
                    for (const time of [5, 9.3, 14.1]) {
                        const r = ribbonRadius(angle, { ...playing, time, treble, level: 0.8, strand });
                        low = Math.min(low, r);
                        high = Math.max(high, r);
                    }
                assert.ok(low >= base - IDLE.reach - 1e-12, `strand ${strand} treble ${treble} inside: ${low}`);
                assert.ok(high > base + 2 * IDLE.reach, `strand ${strand} treble ${treble} outside: ${high}`);
            }
    });

    test("its crest stays within the widget's room: at most RIBBON.reach with the ripple", () => {
        assert.ok(RIBBON.reach * (1 + RIBBON.ripple) <= 0.25, `${RIBBON.reach} * (1 + ${RIBBON.ripple})`);
    });

    test("its slope is continuous across 6 and 12 o'clock, where the mirrored halves meet", () => {
        const values = Array.from({ length: 32 }, (_, i) => [0.9, 0.1, 0.6, 1, 0, 0.35, 0.8][i % 7]);
        for (const bassStretch of [1, 1.4])
            for (const flow of [0, 0.7, 2.9])
                for (let strand = 0; strand < 3; strand++) {
                    // The whole ribbon: each angle's level from the smoothed spectrum, as drawn.
                    const at = angle => ribbonRadius(angle, {
                        ...playing, flow, strand,
                        level: Math.min(1, 1.3 * ribbonLevel(values, spectrumAt(angle, bassStretch))) * 0.7,
                    });
                    for (const angle of [180, 360]) {
                        const [left, right] = slopes(at, angle, 1e-6);
                        assert.ok(Math.abs(left - right) < 1e-3, `${angle} strand ${strand} flow ${flow}: ${left} vs ${right}`);
                    }
                }
    });

    test("treble never flattens a crest, nor a trough: every turn of the wave stays round", () => {
        for (const treble of [0, 0.5, 1])
            for (let strand = 0; strand < 3; strand++) {
                const at = angle => ribbonRadius(angle, { ...playing, treble, level: 1, strand });
                let turns = 0;
                for (let angle = 0; angle < 360; angle += 0.25) {
                    const r = at(angle), before = at(angle - 0.25), after = at(angle + 0.25);
                    // A clamped wave sits still at its crests or troughs: no change on either side.
                    // (Around 6 and 12 o'clock the halves meet in a rounded turn, left out here.)
                    const mirror = angle % 180 < 15 || angle % 180 > 165;
                    if (!mirror && ((r >= before && r >= after) || (r <= before && r <= after))) {
                        turns++;
                        const bend = Math.min(Math.abs(r - at(angle - 2)), Math.abs(r - at(angle + 2)));
                        assert.ok(bend > 1e-4, `treble ${treble} strand ${strand} flat at ${angle}: ${bend}`);
                    }
                }
                assert.ok(turns >= 4, `treble ${treble} strand ${strand}: ${turns} turns`);
            }
    });

    test("a louder level swings it farther out", () => {
        for (let strand = 0; strand < 3; strand++) {
            const soft = span(0.4, strand), loud = span(0.9, strand);
            assert.ok(loud.high > soft.high, `strand ${strand}`);
        }
    });

    // The level the ribbons wave with is the spectrum smoothed along the ring, so a jump from one
    // band to the next doesn't kink a strand.
    test("its level is the spectrum smoothed: gentler than the bands, flat at both ends", () => {
        const values = Array.from({ length: 32 }, (_, i) => [0.9, 0.1, 0.6, 1, 0, 0.35, 0.8][i % 7]);
        let steepest = 0, steepestRaw = 0;
        for (let s = 0.01; s < 0.99; s += 0.002) {
            steepest = Math.max(steepest, Math.abs(slopes(x => ribbonLevel(values, x), s)[0]));
            steepestRaw = Math.max(steepestRaw, Math.abs(slopes(x => spectrumLevel(values, x), s)[0]));
        }
        assert.ok(steepest < steepestRaw / 3, `${steepest} vs ${steepestRaw}`);
        for (const s of [0, 1]) {
            const [left, right] = slopes(x => ribbonLevel(values, x), s, 1e-6);
            assert.ok(Math.abs(left) < 1e-3 && Math.abs(right) < 1e-3, `at ${s}: ${left}, ${right}`);
        }
        for (let s = 0; s <= 1; s += 0.01) {
            const level = ribbonLevel(values, s);
            assert.ok(level >= 0 && level <= 1, `${s}: ${level}`);
        }
    });
});

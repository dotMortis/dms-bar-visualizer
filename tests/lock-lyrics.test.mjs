// The Lock Ring's Lyric Words, apart from drawing (lock-ring/lyrics.mjs): where each letter of a
// word sits on its Ribbon or Hand, the colour it glows in, and how it pops in, takes a Shockwave
// and dissolves. LockRing.qml draws from it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { handPoses } from "../lock-ring/hands.mjs";
import { TIME_FONT } from "../lock-ring/clock.mjs";
import { IDLE } from "../lock-ring/ring.mjs";
import { WORD_FONT, wordLook, wordPlacement } from "../lock-ring/lyrics.mjs";

const DIAL = 100; // px
const silence = new Array(32).fill(0);
const loud = new Array(32).fill(1);

// A scene at the local time `date` (hands at its angles), in silence unless `values` says else.
function scene({ date = new Date(2026, 0, 1, 3, 0, 0), values = silence, handLevels = { bass: 0, mid: 0, treble: 0 } } = {}) {
    return {
        dialRadius: DIAL, values, flow: 0, time: 0, treble: 0, swell: 0, kick: 0, bassStretch: 1.4,
        kickAges: [], kickPowers: [], kickSeeds: [],
        poses: handPoses(date, handLevels), phases: { hour: 0, minute: 0, second: 0 },
    };
}

const five = [10, 10, 10, 10, 10];  // a five-letter word's advances, 10 px each
const dist = g => Math.hypot(g.x, g.y);
const near = (actual, expected, tolerance, what) =>
    assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual}, expected ${expected} ± ${tolerance}`);
// A rotation in degrees, folded into -180..180.
const fold = deg => ((deg % 360) + 540) % 360 - 180;

describe("a word on a Ribbon", () => {
    test("sits on the Ribbon: by the dial in silence, farther out with loud music", () => {
        const spot = { on: "ribbon", ribbon: 0, angle: 45 };
        for (const g of wordPlacement(spot, five, scene()).glyphs)
            near(dist(g), DIAL, IDLE.reach * DIAL + 1e-9, "radius in silence");
        for (const g of wordPlacement(spot, five, scene({ values: loud })).glyphs)
            assert.ok(dist(g) > DIAL * 1.05, `radius with music: ${dist(g)}`);
    });

    test("bends along the ring: each letter turned to its own spot's tangent", () => {
        const { glyphs } = wordPlacement({ on: "ribbon", ribbon: 1, angle: 90 }, five, scene());
        const rotations = glyphs.map(g => g.rotation);
        assert.ok(new Set(rotations.map(r => r.toFixed(3))).size === glyphs.length, "every letter turned its own way");
        near(fold(rotations[2]), 90, 8, "the middle letter at 3 o'clock");
    });

    test("reads left to right and upright, at the top as at the bottom", () => {
        for (const angle of [0, 180]) {
            const { glyphs } = wordPlacement({ on: "ribbon", ribbon: 0, angle }, five, scene());
            assert.ok(glyphs[0].x < glyphs[4].x, `at ${angle}°, the first letter left of the last`);
            near(fold(glyphs[2].rotation), 0, 8, `at ${angle}°, the middle letter upright`);
            assert.equal(Math.sign(glyphs[2].y), angle === 0 ? -1 : 1, `at ${angle}°, above or below the center`);
        }
    });

    test("is centered on its spot, its letters a letter's advance apart", () => {
        const { glyphs, x, y } = wordPlacement({ on: "ribbon", ribbon: 2, angle: 30 }, five, scene());
        near(Math.atan2(glyphs[2].x, -glyphs[2].y) * 180 / Math.PI, 30, 1, "the middle letter's angle");
        near(Math.atan2(x, -y) * 180 / Math.PI, 30, 1, "the word's angle");
        for (let i = 1; i < 5; i++)
            near(Math.hypot(glyphs[i].x - glyphs[i - 1].x, glyphs[i].y - glyphs[i - 1].y), 10, 1, `letters ${i - 1} and ${i}`);
    });
});

describe("a word on a Hand", () => {
    // 03:00: the hour hand points at 3 o'clock, the minute and second hands at 12.
    test("lies along its Hand, inside its reach, reading left to right", () => {
        const s = scene();
        const hour = s.poses.hour;
        const { glyphs } = wordPlacement({ on: "hand", hand: "hour", along: 0.5 }, [10, 10, 10], s);
        for (const g of glyphs) {
            near(g.y, 0, 1e-6, "on the axis (a straight hand in silence)");
            assert.ok(g.x >= hour.inner * DIAL && g.x <= hour.length * DIAL, `within the hand: ${g.x}`);
            near(fold(g.rotation), 0, 1e-6, "along it");
        }
        assert.ok(glyphs[0].x < glyphs[2].x);
    });

    test("turns with its Hand, and still reads upright on the left half", () => {
        const at9 = scene({ date: new Date(2026, 0, 1, 9, 0, 0) });
        const left = wordPlacement({ on: "hand", hand: "hour", along: 0.5 }, five, at9).glyphs;
        assert.ok(left.every(g => g.x < 0), "left of the center");
        assert.ok(left[0].x < left[4].x, "left to right");
        near(fold(left[2].rotation), 0, 1e-6, "upright");

        const up = wordPlacement({ on: "hand", hand: "minute", along: 0.5 }, five, scene()).glyphs;
        assert.ok(up.every(g => Math.abs(g.x) < 1e-6 && g.y < 0), "up the minute hand at 12");
        near(fold(up[2].rotation), -90, 1e-6, "reading outward");
    });

    test("stays on its Hand: a word near either end is pulled in so it ends there", () => {
        const s = scene();
        const three = [10, 10, 10];
        const tip = wordPlacement({ on: "hand", hand: "hour", along: 1 }, three, s).glyphs;
        near(tip[2].x + 5, s.poses.hour.length * DIAL, 1e-6, "the last letter's end at the tip");
        const inner = wordPlacement({ on: "hand", hand: "hour", along: 0 }, three, s).glyphs;
        near(inner[0].x - 5, s.poses.hour.inner * DIAL, 1e-6, "the first letter's start at the inner end");
    });

    // The short hour hand can't hold a long word; words at different spots along it still land
    // apart rather than all in its middle.
    test("a word longer than its Hand starts at the inner end and reaches past the tip by its spot", () => {
        const s = scene();
        const long = new Array(8).fill(10);
        const at = along => wordPlacement({ on: "hand", hand: "hour", along }, long, s).glyphs;
        near(at(0)[0].x - 5, s.poses.hour.inner * DIAL, 1e-6, "from the inner end");
        assert.ok(at(1)[0].x > at(0)[0].x + 10, "farther out for a spot near the tip");
    });

    test("bends with the Hand's wave", () => {
        const s = scene({ handLevels: { bass: 1, mid: 1, treble: 1 } });
        const { glyphs } = wordPlacement({ on: "hand", hand: "hour", along: 0.5 }, five, s);
        assert.ok(glyphs.some(g => Math.abs(g.y) > 0.5), "off the straight axis");
    });
});

describe("a word's colour", () => {
    test("on a Hand, the Hand's own: lavender, mauve, pink", () => {
        const s = scene();
        const colors = ["hour", "minute", "second"].map(hand => wordPlacement({ on: "hand", hand, along: 0.5 }, five, s).color);
        assert.equal(new Set(colors).size, 3);
        for (const c of colors)
            assert.match(c, /^#[0-9a-f]{6}$/);
    });

    test("on a Ribbon, its strand's at that spot: it changes around the ring and between strands", () => {
        const s = scene({ values: loud });
        const at = (ribbon, angle) => wordPlacement({ on: "ribbon", ribbon, angle }, five, s).color;
        assert.match(at(0, 0), /^#[0-9a-f]{6}$/);
        assert.notEqual(at(0, 0), at(1, 0));
        assert.notEqual(at(0, 0), at(0, 120));
    });
});

describe("a word's look", () => {
    const word = { popIn: 1, pop: 0.4, dissolve: 0, brightness: 1 };
    const look = (w, crossing = 0) => wordLook(Object.assign({}, word, w), crossing);

    test("pops in oversized and flashing, then settles", () => {
        const landing = look({ popIn: 0 }), settled = look({ popIn: 1 });
        assert.ok(landing.scale > 1, "oversized as it lands");
        assert.ok(landing.white > settled.white, "a flash");
        assert.equal(settled.scale, 1);
        assert.equal(settled.opacity, 1);
    });

    test("pops harder with a Kick", () => {
        assert.ok(look({ popIn: 0, pop: 1 }).scale > look({ popIn: 0, pop: 0.4 }).scale);
        assert.ok(look({ popIn: 0.2, pop: 1 }).white > look({ popIn: 0.2, pop: 0.4 }).white);
    });

    test("dissolves to nothing, and a background vocal is dimmer", () => {
        assert.ok(look({ dissolve: 0.5 }).opacity < 1);
        assert.equal(look({ dissolve: 1 }).opacity, 0);
        assert.ok(look({ dissolve: 0.5 }).blur > 0);
        assert.ok(look({ brightness: 0.55 }).opacity < 1);
    });

    test("a Shockwave crossing it splits it into coloured copies and flares it, like the Digital Time", () => {
        const calm = look({}, 0), hit = look({}, 1);
        assert.ok(calm.hit.copies.every(c => c.opacity === 0));
        assert.ok(hit.hit.copies.every(c => c.opacity > 0 && c.offset > 0));
        assert.ok(hit.white > calm.white);
    });
});

test("words scale with the ring, smaller than the Digital Time", () => {
    assert.ok(WORD_FONT > 0 && WORD_FONT < TIME_FONT);
});

// Lyric Words on the Bar Visualizer, apart from drawing (docs/bar-words.mjs): where each letter of
// a word sits as it rides its Ribbon, and how the word looks as it pops in, takes a Shockwave and
// dissolves. shell.qml draws them from this; docs/lyric-words.mjs says which words show when.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ribbonHeight } from "../docs/bar-ribbons.mjs";
import { LOOK, layWord, rowWidths, wordLook } from "../docs/bar-words.mjs";

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-6, `${msg ?? ""} ${actual} != ${expected}`);

// An 800 x 40 bar, waving at full level.
const loud = { width: 800, height: 40, values: Array(32).fill(1), time: 0, kick: 0, treble: 0, flow: 0, bassStretch: 1, kickAges: [], kickPowers: [] };
const quiet = { ...loud, values: Array(32).fill(0) };
// A five-letter word, each letter 10 px wide, 6 px either side of its middle.
const WORD = [10, 10, 10, 10, 10];
const lay = (spot, inputs, clearance = 6) => layWord(spot, WORD, { ...inputs, clearance });

describe("a Lyric Word on the bar", () => {
    test("sits across the bar where its spot says, its letters side by side", () => {
        const left = lay({ ribbon: 0, x: 0 }, quiet), right = lay({ ribbon: 0, x: 1 }, quiet);
        assert.deepEqual(left.map(g => g.x), [5, 15, 25, 35, 45]);
        assert.deepEqual(right.map(g => g.x), [755, 765, 775, 785, 795]);
        near(lay({ ribbon: 0, x: 0.5 }, quiet)[2].x, 400, "in the middle:");
    });

    test("in a row, sits after the words before it, the whole row placed across the bar", () => {
        // A 200 px row, 100 px of it before this word.
        const row = { width: 200, before: 100 };
        assert.deepEqual(layWord({ ribbon: 0, x: 0 }, WORD, { ...quiet, clearance: 6 }, row).map(g => g.x), [105, 115, 125, 135, 145]);
        assert.deepEqual(layWord({ ribbon: 0, x: 1 }, WORD, { ...quiet, clearance: 6 }, row).map(g => g.x), [705, 715, 725, 735, 745]);
    });

    test("a row's words stand LOOK.space ems apart, wider than a space", () => {
        // Letters 10 px wide, a 20 px em: "ab cd" is two 20 px words and one gap.
        const row = rowWidths({ row: "ab cd", before: "ab " }, () => 10, 20);
        assert.ok(LOOK.space * 20 > 10, "wider than the font's space");
        assert.deepEqual(row, { width: 40 + LOOK.space * 20, before: 20 + LOOK.space * 20 });
    });

    test("a row wider than the bar starts at its left edge", () => {
        const glyphs = layWord({ ribbon: 0, x: 0.7 }, WORD, { ...quiet, clearance: 6 }, { width: 1000, before: 50 });
        assert.equal(glyphs[0].x, 55);
    });

    test("lies along the middle of the bar on a flat Ribbon", () => {
        for (const g of lay({ ribbon: 1, x: 0.3 }, quiet)) {
            near(g.y, 20);
            near(g.angle, 0);
        }
    });

    // Where a letter at `x` on `ribbon` follows its Ribbon to: LOOK.wave.follow of its offset from
    // the bar's middle (20 px), if that stays within reach.
    const followed = (x, ribbon, inputs) => 20 + LOOK.wave.follow * (ribbonHeight(x, ribbon, inputs) * 40 - 20);

    test("follows its Ribbon's wave part way, tilted with it but less", () => {
        assert.ok(LOOK.wave.follow > 0 && LOOK.wave.follow < 1, String(LOOK.wave.follow));
        const glyphs = lay({ ribbon: 0, x: 0.52 }, loud, 0);
        const within = glyphs.filter(g => Math.abs(g.y - 20) < LOOK.wave.reach * 40 - 1e-6);
        assert.ok(within.length > 0, "some letters within reach");
        for (const g of within) {
            near(g.y, followed(g.x, 0, loud), `letter at ${g.x}:`);
            const ribbonTilt = Math.atan2((ribbonHeight(g.x + 1, 0, loud) - ribbonHeight(g.x - 1, 0, loud)) * 40, 2) * 180 / Math.PI;
            assert.equal(Math.sign(g.angle), Math.sign(ribbonTilt), `letter at ${g.x} tilts with the Ribbon`);
            assert.ok(Math.abs(g.angle) <= Math.abs(ribbonTilt), `but less: ${g.angle} vs ${ribbonTilt}`);
        }
    });

    test("rides its own Ribbon", () => {
        const a = lay({ ribbon: 1, x: 0.5 }, quiet, 0)[2], b = lay({ ribbon: 2, x: 0.5 }, loud, 0)[2];
        near(a.y, followed(400, 1, quiet));
        assert.equal(Math.sign(b.y - 20), Math.sign(ribbonHeight(400, 2, loud) * 40 - 20), "to its side of the middle");
    });

    test("moves with the Ribbon's wave", () => {
        const before = lay({ ribbon: 0, x: 0.6 }, loud, 0), after = lay({ ribbon: 0, x: 0.6 }, { ...loud, flow: 1 }, 0);
        assert.deepEqual(after.map(g => g.x), before.map(g => g.x), "stays where it landed across the bar");
        assert.notEqual(after[0].y, before[0].y, "but goes up and down with the wave");
    });

    test("strays at most LOOK.wave.reach of the bar's height from its middle, even on a crest", () => {
        const crest = { ...loud, kickAges: [0], kickPowers: [1], kick: 1 };
        assert.ok(LOOK.wave.reach > 0 && LOOK.wave.reach < 0.5, String(LOOK.wave.reach));
        let farthest = 0;
        for (let x = 0; x <= 1; x += 0.05)
            for (const ribbon of [0, 1, 2])
                for (const g of lay({ ribbon, x }, crest, 0))
                    farthest = Math.max(farthest, Math.abs(g.y - 20));
        assert.ok(farthest <= LOOK.wave.reach * 40 + 1e-9, `${farthest}`);
        assert.ok(farthest > 0, "but still waves");
    });

    test("stays inside the bar's thickness on a crest that leaves it", () => {
        const crest = { ...loud, kickAges: [0], kickPowers: [1], kick: 1 };
        for (const x of [0, 0.25, 0.5, 0.75, 1])
            for (const ribbon of [0, 1, 2])
                for (const g of lay({ ribbon, x }, crest, 14))
                    assert.ok(g.y >= 14 && g.y <= 26, `${g.y} at ${x} on ${ribbon}`);
    });
});

const word = (fields) => Object.assign({ size: 1, brightness: 1, popIn: 1, pop: 0.4, dissolve: 0 }, fields);

describe("a Lyric Word's look", () => {
    test("pops in oversized with a flash, then settles to its size", () => {
        const start = wordLook(word({ popIn: 0.1 }), 0), settled = wordLook(word({ popIn: 1 }), 0);
        assert.ok(start.scale > 1.1, `oversized: ${start.scale}`);
        assert.ok(start.white > 0.2, `flashing: ${start.white}`);
        near(settled.scale, 1);
        near(settled.white, 0);
        near(settled.opacity, 1);
    });

    test("pops harder with a Kick", () => {
        const plain = wordLook(word({ popIn: 0.2, pop: 0.4 }), 0), kicked = wordLook(word({ popIn: 0.2, pop: 1 }), 0);
        assert.ok(kicked.scale > plain.scale);
        assert.ok(kicked.white > plain.white);
        assert.ok(kicked.glow > plain.glow);
    });

    test("a background vocal is smaller and dimmer", () => {
        const back = wordLook(word({ size: 0.7, brightness: 0.55 }), 0);
        near(back.scale, 0.7);
        near(back.opacity, 0.55);
    });

    test("dissolves to nothing", () => {
        const half = wordLook(word({ dissolve: 0.5 }), 0), gone = wordLook(word({ dissolve: 1 }), 0);
        assert.ok(half.opacity < 1 && half.opacity > 0);
        assert.ok(half.blur > 0, "blurring as it goes");
        near(gone.opacity, 0);
    });

    test("flares and splits into colored copies as a Shockwave crosses it", () => {
        const calm = wordLook(word({}), 0), hit = wordLook(word({}), 1), half = wordLook(word({}), 0.5);
        assert.ok(calm.copies.every(c => c.opacity === 0 && c.offset === 0), "no copies without a Shockwave");
        assert.ok(hit.copies.length >= 3);
        assert.equal(new Set(hit.copies.map(c => c.color)).size, hit.copies.length, "each its own color");
        assert.ok(hit.copies.every(c => c.opacity > 0 && c.offset > 0));
        assert.ok(hit.copies.every((c, i) => c.offset > half.copies[i].offset), "split farther by a stronger crossing");
        assert.ok(hit.white > calm.white && hit.glow > calm.glow, "and flares");
        assert.ok(hit.scale > half.scale && half.scale > calm.scale, "and swells with the hit");
    });

    test("a full hit splits its copies well clear of the word", () => {
        const hit = wordLook(word({}), 1);
        assert.ok(Math.max(...hit.copies.map(c => c.offset)) >= 0.5, "half a letter or more");
    });
});

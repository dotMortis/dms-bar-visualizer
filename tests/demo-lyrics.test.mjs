// The live demo's Lyric Words (docs/demo-lyrics.mjs): a short set of timed lines we wrote for
// the demo, in DMS's lyrics format, looped against the demo's own clock through the shared
// Lyric Words module. Both demo views use them: the Lock Ring's (Ribbons or Hands) and the bar's
// (Ribbons only).
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEMO_LINES, DEMO_LOOP, createDemoLyrics } from "../docs/demo-lyrics.mjs";

const START = 50_000; // ms, the page clock when the demo starts
const at = seconds => START + seconds * 1000;
const texts = words => words.map(w => w.text);

describe("the demo lines", () => {
    test("have a line with word timing, one of its words split into syllables", () => {
        const timed = DEMO_LINES.filter(l => Array.isArray(l.w));
        assert.ok(timed.length > 0);
        assert.ok(timed.some(l => l.w.some(p => !/\s$/.test(p.x) && p !== l.w[l.w.length - 1])),
            "a piece without a trailing space: a word in syllables");
        for (const l of timed)
            assert.equal(l.w.map(p => p.x).join(""), l.x, "its pieces join to its text, so DMS keeps them");
    });

    test("have a line with line timing only, and a background vocal", () => {
        assert.ok(DEMO_LINES.some(l => !l.w && !l.background));
        assert.ok(DEMO_LINES.some(l => l.background === true));
    });

    test("fit in the loop, with a gap of a few seconds between two lines", () => {
        const sorted = [...DEMO_LINES].sort((a, b) => a.t - b.t);
        assert.ok(sorted.every(l => l.t >= 0 && l.e <= DEMO_LOOP));
        const gaps = sorted.slice(1).map((l, i) => l.t - Math.max(...sorted.slice(0, i + 1).map(p => p.e)));
        assert.ok(Math.max(...gaps) >= 3, `the longest gap: ${Math.max(...gaps)} s`);
    });
});

describe("the demo's Lyric Words", () => {
    test("show the syllables as one word, once sung", () => {
        const lyrics = createDemoLyrics({ start: START });
        assert.deepEqual(texts(lyrics.words(at(0.5))), []);
        assert.deepEqual(texts(lyrics.words(at(1.6))), ["Neon", "rivers"]);
    });

    test("show nothing in the gap between lines", () => {
        const lyrics = createDemoLyrics({ start: START });
        lyrics.words(at(7));
        assert.deepEqual(lyrics.words(at(11)), []);
    });

    test("loop: the same words come again a loop later", () => {
        const lyrics = createDemoLyrics({ start: START });
        const first = texts(lyrics.words(at(6.8)));
        lyrics.words(at(DEMO_LOOP - 0.1));
        assert.deepEqual(texts(lyrics.words(at(DEMO_LOOP + 0.5))), []);
        assert.deepEqual(texts(lyrics.words(at(DEMO_LOOP + 6.8))), first);
        assert.ok(first.length > 0);
    });

    test("pop harder with the demo's Kicks", () => {
        const lyrics = createDemoLyrics({ start: START });
        lyrics.kick(1, at(1.0));
        const [neon] = lyrics.words(at(1.1));
        const calm = createDemoLyrics({ start: START }).words(at(1.1))[0];
        assert.ok(neon.pop > calm.pop);
    });

    test("land on Ribbons or Hands for the Lock Ring, on Ribbons only for the bar", () => {
        const everyWord = placement => {
            const lyrics = createDemoLyrics({ start: START, placement, seed: 7 });
            const spots = [];
            for (let s = 0; s < DEMO_LOOP; s += 0.25)
                spots.push(...lyrics.words(at(s)).map(w => w.spot.on));
            return new Set(spots);
        };
        assert.deepEqual(everyWord("ribbons-or-hands"), new Set(["ribbon", "hand"]));
        assert.deepEqual(everyWord("ribbons"), new Set(["ribbon"]));
    });
});

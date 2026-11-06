// cava's raw ascii output, one line per frame, turned into the bands both visualizers draw from.
// Whatever runs as the capture, its lines are parsed this one way.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BANDS, parseBands } from "../docs/kick.mjs";

// A line as cava prints it: BANDS integers 0..1000, each followed by ";".
const line = values => values.map(v => `${v};`).join("");

describe("parsing cava's lines", () => {
    test("each band is cava's 0..1000 as 0..1, bass first", () => {
        const raw = new Array(BANDS).fill(0);
        raw[0] = 1000;
        raw[1] = 412;
        raw[BANDS - 1] = 7;
        const bands = parseBands(line(raw));
        assert.equal(bands.length, BANDS);
        assert.equal(bands[0], 1);
        assert.equal(bands[1], 0.412);
        assert.equal(bands[2], 0);
        assert.equal(bands[BANDS - 1], 0.007);
    });

    test("a line with fewer bands than cava's layout is no frame", () => {
        assert.equal(parseBands(line(new Array(BANDS - 1).fill(500))), null);
        assert.equal(parseBands(""), null);
    });

    test("anything after the last band is ignored", () => {
        const bands = parseBands(line(new Array(BANDS).fill(250)) + "999;123;");
        assert.equal(bands.length, BANDS);
        assert.ok(bands.every(b => b === 0.25));
    });
});

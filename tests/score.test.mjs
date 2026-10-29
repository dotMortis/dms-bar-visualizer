// The replay's scoring rules (spec #1, "Scoring"), as worked examples.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { score } from "./replay.mjs";

describe("scoring", () => {
    test("a kick after an onset counts for it, and its delay is the latency", () => {
        const result = score([1.0, 2.0], [1.1, 2.05]);
        assert.deepEqual(result.missed, []);
        assert.deepEqual(result.doubled, []);
        assert.deepEqual(result.stray, []);
        assert.equal(Math.round(result.latency * 1000), 75);  // median of 100 and 50 ms
    });

    test("an onset without a kick is missed, one with two kicks is doubled", () => {
        const result = score([1.0, 2.0, 3.0], [1.1, 1.3, 3.1]);
        assert.deepEqual(result.missed, [2.0]);
        assert.deepEqual(result.doubled, [1.0]);
        assert.deepEqual(result.stray, []);
    });

    test("a kick up to 30 ms before an onset counts for it, for timestamp jitter", () => {
        const result = score([1.0, 2.0], [0.98, 2.1]);
        assert.deepEqual(result.stray, []);
        assert.deepEqual(result.missed, []);
    });

    test("a kick too soon after an onset for cava to show it belongs to the onset before", () => {
        // A 16th-note pair: the kick at 1.13 is 9 ms after the second onset, which cava can't show yet.
        const result = score([1.0, 1.121], [1.1, 1.13]);
        assert.deepEqual(result.doubled, [1.0]);
        assert.deepEqual(result.missed, [1.121]);
    });

    test("a kick just before an onset belongs to the onset before, while that one's window is open", () => {
        const result = score([1.0, 1.121], [1.1]);
        assert.deepEqual(result.missed, [1.121]);
        assert.deepEqual(result.doubled, []);
    });

    test("a first kick more than 150 ms after its onset is late", () => {
        const result = score([1.0, 2.0], [1.2, 2.1]);
        assert.deepEqual(result.late, [1.0]);
    });

    test("a kick more than 350 ms after the latest onset, or before the first, is stray", () => {
        const result = score([1.0, 2.0], [0.5, 1.34, 1.36, 2.1]);
        assert.deepEqual(result.stray, [0.5, 1.36]);
        assert.deepEqual(result.missed, []);
        assert.deepEqual(result.doubled, []);
    });

    test("with no kicks, every onset is missed and there is no latency", () => {
        const result = score([1.0, 2.0], []);
        assert.deepEqual(result.missed, [1.0, 2.0]);
        assert.ok(Number.isNaN(result.latency));
    });
});

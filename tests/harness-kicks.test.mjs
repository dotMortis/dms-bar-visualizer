// The replay harness's cheap check (harness/): a run on the reference track must give the Kicks
// the kick-replay tests expect for it. Only the comparison runs here; the harness itself doesn't.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { REFERENCE_TRACK, checkKicks, replayTrack } from "../harness/kicks.mjs";

// A made-up track: Kicks at 1, 2 and 3 s of a 4 s loop.
const expected = [1, 2, 3];
const length = 4;

describe("harness kick check", () => {
    test("a run with every loop's Kicks on time passes", () => {
        const live = [1.004, 2, 2.996, 5.01, 6, 7];
        const result = checkKicks(live, { expected, length, loops: 2 });
        assert.equal(result.ok, true);
        assert.deepEqual(result.loops.map(l => [l.kicks, l.missed, l.extra]), [[3, 0, 0], [3, 0, 0]]);
        assert.equal(result.loops[1].worstMs, 10);
    });

    test("a missed, a doubled or a late Kick fails its loop", () => {
        const missed = checkKicks([1, 2], { expected, length, loops: 1 });
        assert.equal(missed.ok, false);
        assert.equal(missed.loops[0].missed, 1);

        const doubled = checkKicks([1, 1.02, 2, 3], { expected, length, loops: 1 });
        assert.equal(doubled.ok, false);
        assert.deepEqual([doubled.loops[0].missed, doubled.loops[0].extra], [0, 1]);

        // More than two frames late is another Kick, not this one.
        const late = checkKicks([1, 2.05, 3], { expected, length, loops: 1 });
        assert.deepEqual([late.ok, late.loops[0].missed, late.loops[0].extra], [false, 1, 1]);
    });

    test("the reference track is steady_house: 44 Kicks a 24.05 s loop, as the kick-replay tests expect", () => {
        const track = replayTrack(REFERENCE_TRACK);
        assert.equal(REFERENCE_TRACK, "steady_house");
        assert.equal(track.expected.length, 44);
        assert.ok(Math.abs(track.length - 24.05) < 0.001, `loop length ${track.length}`);
        // Times into the track: its first Kick comes after the 2 s of silence it starts with.
        assert.ok(track.expected[0] > 1.5 && track.expected[0] < 2.5, `first Kick at ${track.expected[0]}`);
    });

    test("Kicks during the warm-up or after the last whole loop don't count", () => {
        const result = checkKicks([-2.5, -1, 1, 2, 3, 4.2], { expected, length, loops: 1 });
        assert.equal(result.ok, true);
        assert.equal(result.loops.length, 1);
    });
});

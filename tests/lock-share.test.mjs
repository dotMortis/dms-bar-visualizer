// Every Lock Ring on every monitor shares one audio capture. It runs while at least one ring holds
// it: rings join when they're created on lock and leave when they're destroyed on unlock.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createShare } from "../lock-ring/share.mjs";

describe("shared capture", () => {
    test("is off until a ring joins", () => {
        assert.equal(createShare().active, false);
    });

    test("runs once a ring joins, and stops when the last of two rings leaves", () => {
        const share = createShare(), left = {}, right = {};
        share.join(left);
        assert.equal(share.active, true);
        share.join(right);
        share.leave(left);
        assert.equal(share.active, true, "one monitor still locked");
        share.leave(right);
        assert.equal(share.active, false);
    });

    test("a ring that joins twice still leaves once", () => {
        const share = createShare(), ring = {};
        share.join(ring);
        share.join(ring);
        share.leave(ring);
        assert.equal(share.active, false);
    });

    test("a ring that leaves twice doesn't stop another ring's capture", () => {
        const share = createShare(), gone = {}, staying = {};
        share.join(gone);
        share.join(staying);
        share.leave(gone);
        share.leave(gone);
        assert.equal(share.active, true);
    });

    test("join and leave return how many rings hold it", () => {
        const share = createShare(), a = {}, b = {};
        assert.deepEqual([share.join(a), share.join(b), share.leave(a), share.leave(b)], [1, 2, 1, 0]);
    });
});

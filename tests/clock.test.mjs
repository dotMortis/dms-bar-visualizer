// The visualizer stamps each cava frame with the wall clock when it arrives, which can step back
// (an NTP correction, the time set by hand). A step back counts as no time passing.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createKickDetector } from "../docs/kick.mjs";
import { CONFIGS } from "./replay.mjs";

const FPS = 60;

// Two seconds at 60 fps: silence, and a hit in band 2 at 1 s and again at 1.5 s, each dying down
// within 0.1 s. Both land in the same band, so the second one only fires once the first has ended.
const HITS = Array.from({ length: 2 * FPS }, (_, n) => {
    const values = new Array(32).fill(0);
    for (const at of [1, 1.5]) {
        if (n >= at * FPS)
            values[2] = 0.8 * Math.exp(-(n / FPS - at) / 0.04);
    }
    return values;
});

// The frames at which kicks fire, with frame n stamped clock(n) seconds.
function kicksOn(clock, settings) {
    const detector = createKickDetector(settings);
    return HITS.flatMap((values, n) => detector.push(values, clock(n)) ? [n] : []);
}

describe("clock", () => {
    for (const [config, settings] of Object.entries(CONFIGS)) {
        test(`at ${config}, a clock stepping back fires the kicks of one standing still for a frame`, () => {
            // At 1.1 s, while the first hit dies down.
            const step = 1.1 * FPS;
            const still = n => (n < step ? n : n - 1) / FPS;
            assert.deepEqual(kicksOn(still, settings), [1 * FPS, 1.5 * FPS]);
            for (const back of [1, 3600]) {
                const stepped = n => n / FPS - (n < step ? 0 : back);
                assert.deepEqual(kicksOn(stepped, settings), kicksOn(still, settings), `the clock stepping back by ${back} s`);
            }
        });
    }
});

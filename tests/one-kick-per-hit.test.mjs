// One kick drum hit fires one kick, at any kickThreshold the demo's slider offers (0.06 to 0.9):
// lowering it makes more hits fire, and never makes one hit fire twice.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONFIGS, FIXTURES, TRACKS, replay, score } from "./replay.mjs";

describe("one kick per hit", () => {
    for (const [config, settings] of Object.entries(CONFIGS)) {
        test(`at ${config}, 16th-note kick pairs further apart than kickCooldown fire as two kicks`, () => {
            // double_kick has a softer kick a 16th note (121 ms) before every 4th beat, so the beat's
            // kick comes while the 16th still rings.
            const { onsets, frames } = FIXTURES.double_kick;
            const pairs = onsets.flatMap((t, i) => i && t - onsets[i - 1] < 0.2 ? [[onsets[i - 1], t]] : []);
            assert.equal(pairs.length, 10);
            assert.ok(pairs.every(([a, b]) => b - a > settings.kickCooldown));
            const { missed } = score(onsets, replay(frames, settings).map(k => k.time));
            const lost = pairs.flat().filter(t => missed.includes(t));
            assert.deepEqual(lost, [], "onsets of a pair without a kick");
        });
    }

    // The demo's slider, every step below 0.15. At 0.05, zoo3 loses its onset at 7.81 s: a bass
    // note swelling by 0.06 of the peak fires just before it, and holds back the kick after it.
    const THRESHOLDS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06];

    for (const kickCooldown of [0.1, 0.12]) {
        test(`lowering kickThreshold fires more hits and none twice (kickCooldown ${kickCooldown})`, () => {
            for (const scenario of TRACKS) {
                const { onsets, frames } = FIXTURES[scenario];
                let caught = [];
                for (const kickThreshold of THRESHOLDS) {
                    const settings = { ...CONFIGS.defaults, kickThreshold, kickCooldown };
                    const { missed, doubled } = score(onsets, replay(frames, settings).map(k => k.time));
                    assert.deepEqual(doubled, [], `${scenario} at kickThreshold ${kickThreshold}: onsets that fire twice`);
                    const lost = caught.filter(t => missed.includes(t));
                    assert.deepEqual(lost, [], `${scenario}: onsets that fire at a higher kickThreshold but not at ${kickThreshold}`);
                    caught = onsets.filter(t => !missed.includes(t));
                }
            }
        });
    }
});

// One kick drum hit fires one kick, whatever kickThreshold is set to: lowering it makes more hits
// fire, and never makes one hit fire twice.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { readFixture, replay, score } from "./replay.mjs";

const SCENARIOS = fs.readdirSync(new URL("fixtures/", import.meta.url))
    .filter(f => f.endsWith(".txt")).map(f => f.slice(0, -4)).sort();
const FIXTURES = Object.fromEntries(SCENARIOS.map(s => [s, readFixture(s)]));
const TRACKS = SCENARIOS.filter(s => FIXTURES[s].onsets.length);  // all but the tone sweep

describe("one kick per hit", () => {
    // From the top of the demo's slider down to 0.15. Below that, bass notes start to fire as well
    // (strays), and one that comes just before a kick drum counts towards it.
    const THRESHOLDS = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15];

    for (const kickCooldown of [0.1, 0.12]) {
        test(`lowering kickThreshold fires more hits and none twice (kickCooldown ${kickCooldown})`, () => {
            for (const scenario of TRACKS) {
                const { onsets, frames } = FIXTURES[scenario];
                let caught = [];
                for (const kickThreshold of THRESHOLDS) {
                    const settings = { kickThreshold, kickLowHz: 30, kickHighHz: 90, kickCooldown };
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

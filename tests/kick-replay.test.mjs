// Replays real cava output, recorded from synthesized tracks with known kick onsets (see
// fixtures/record.py), through the kick detector, and holds each track to a budget of missed,
// doubled and stray kicks and of median onset-to-kick latency. Prints the numbers per track.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { overBudget, readFixture, replay, report, score } from "./replay.mjs";

const CONFIGS = {
    defaults: { kickThreshold: 0.4, kickLowHz: 30, kickHighHz: 90, kickCooldown: 0.12 },
    sensitive: { kickThreshold: 0.2, kickLowHz: 30, kickHighHz: 90, kickCooldown: 0.1 },
};

// Today's measured result per track, not a target: the detector of v0.4.1 (docs/kick.mjs as it
// came out of shell.qml) listening to the bands cava puts 30-90 Hz in (0-6, was 0-5 before #4),
// replayed on these recordings on 2026-10-29. latency is the median onset-to-kick delay in ms. A
// change may only lower a budget. One that has to raise a budget says why, with numbers, in its PR.
const BUDGETS = {
    defaults: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency:  90 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  94 },
        sustained_bass: { missed:  1, doubled:  0, stray:  1, latency:  94 },
        loud_quiet:     { missed: 23, doubled:  0, stray:  0, latency:  87 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency:  76 },
        double_kick:    { missed: 11, doubled:  0, stray:  0, latency:  97 },
        zoo1:           { missed:  6, doubled:  0, stray:  0, latency: 112 },
        zoo2:           { missed:  6, doubled:  0, stray:  0, latency: 117 },
        zoo3:           { missed:  0, doubled:  0, stray:  0, latency: 117 },
    },
    sensitive: {
        kick_only:      { missed:  1, doubled:  0, stray:  0, latency:  79 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  81 },
        sustained_bass: { missed:  1, doubled: 28, stray: 18, latency:  52 },
        loud_quiet:     { missed:  3, doubled:  0, stray:  0, latency:  87 },
        dnb_808:        { missed:  0, doubled:  0, stray: 15, latency:  63 },
        double_kick:    { missed: 11, doubled:  0, stray:  0, latency:  81 },
        zoo1:           { missed:  1, doubled:  0, stray:  1, latency:  87 },
        zoo2:           { missed:  1, doubled:  0, stray:  0, latency:  88 },
        // missed was 0 with bands 0-5. Band 6 sees the next kick a frame before the last one's tail
        // has left bands 0-5, so v0.4.1's re-arm (on one frame of small jumps) never comes.
        zoo3:           { missed:  2, doubled:  0, stray:  0, latency: 102 },
    },
};

for (const [config, settings] of Object.entries(CONFIGS)) {
    describe(`replay at ${config}`, () => {
        const rows = [];
        for (const [scenario, budget] of Object.entries(BUDGETS[config])) {
            test(`${scenario} stays within its budget`, () => {
                const fixture = readFixture(scenario);
                const kicks = replay(fixture.frames, settings);
                const result = score(fixture.onsets, kicks.map(k => k.time));
                rows.push({ name: scenario, onsets: fixture.onsets.length, kicks: kicks.length, result });
                assert.deepEqual(overBudget(result, budget), [], `${scenario} at ${config}: ${fixture.about}`);
            });
        }
        after(() => console.log(report(`\n${config}: ${JSON.stringify(settings)}`, rows)));
    });
}

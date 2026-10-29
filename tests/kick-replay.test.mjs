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
// came out of shell.qml), replayed on these recordings on 2026-10-29. latency is the median
// onset-to-kick delay in ms. A change may only lower a budget. One that has to raise a budget says
// why, with numbers, in its PR.
const BUDGETS = {
    defaults: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency: 115 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency: 115 },
        sustained_bass: { missed:  1, doubled:  0, stray:  1, latency: 118 },
        loud_quiet:     { missed: 23, doubled:  0, stray:  0, latency: 115 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency: 105 },
        double_kick:    { missed: 11, doubled:  0, stray:  0, latency: 118 },
        zoo1:           { missed:  8, doubled:  0, stray:  0, latency: 144 },
        zoo2:           { missed:  9, doubled:  0, stray:  0, latency: 138 },
        zoo3:           { missed:  1, doubled:  0, stray:  0, latency: 151 },
    },
    sensitive: {
        kick_only:      { missed:  1, doubled:  0, stray:  0, latency: 100 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency: 100 },
        sustained_bass: { missed:  1, doubled: 32, stray: 18, latency:  52 },
        loud_quiet:     { missed:  4, doubled:  0, stray:  0, latency: 111 },
        dnb_808:        { missed:  0, doubled:  0, stray: 15, latency:  89 },
        double_kick:    { missed: 11, doubled:  0, stray:  0, latency: 103 },
        zoo1:           { missed:  2, doubled:  0, stray:  1, latency: 117 },
        zoo2:           { missed:  1, doubled:  0, stray:  0, latency: 121 },
        zoo3:           { missed:  0, doubled:  0, stray:  0, latency: 130 },
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

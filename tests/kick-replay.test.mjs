// Replays real cava output, recorded from synthesized tracks with known kick onsets (see
// fixtures/record.py), through the kick detector, and holds each track to a budget of missed,
// doubled and stray kicks and of median onset-to-kick latency. Prints the numbers per track.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { CONFIGS, FIXTURES, overBudget, replay, report, score } from "./replay.mjs";

// The measured result per track on these recordings, not a target; latency is the median
// onset-to-kick delay in ms. A change may only lower a budget. One that has to raise a budget says
// why, with numbers, in its PR.
const BUDGETS = {
    defaults: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency:  96 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  97 },
        // The stray is the drone coming in at 1.5 s.
        sustained_bass: { missed:  0, doubled:  0, stray:  1, latency:  99 },
        // The first kick after the 12 dB drop, while the peak releases.
        loud_quiet:     { missed:  1, doubled:  0, stray:  0, latency:  97 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency:  84 },
        double_kick:    { missed:  0, doubled:  0, stray:  0, latency: 102 },
        // zoo1 at 18.94 s (a soft kick) and zoo3 at 7.81 s.
        zoo1:           { missed:  1, doubled:  0, stray:  0, latency: 108 },
        zoo2:           { missed:  0, doubled:  0, stray:  0, latency: 108 },
        zoo3:           { missed:  1, doubled:  0, stray:  0, latency: 121 },
    },
    sensitive: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency:  72 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  76 },
        // The stray is the drone coming in at 1.5 s.
        sustained_bass: { missed:  0, doubled:  0, stray:  1, latency:  78 },
        loud_quiet:     { missed:  0, doubled:  0, stray:  0, latency:  71 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency:  56 },
        // The beat kicks right after a 16th note fire 81-106 ms after their onset, as the 16th rings.
        double_kick:    { missed:  0, doubled:  0, stray:  0, latency:  79 },
        zoo1:           { missed:  0, doubled:  0, stray:  0, latency:  83 },
        zoo2:           { missed:  0, doubled:  0, stray:  0, latency:  84 },
        zoo3:           { missed:  0, doubled:  0, stray:  0, latency:  88 },
    },
};

for (const [config, settings] of Object.entries(CONFIGS)) {
    describe(`replay at ${config}`, () => {
        const rows = [];
        for (const [scenario, budget] of Object.entries(BUDGETS[config])) {
            test(`${scenario} stays within its budget`, () => {
                const fixture = FIXTURES[scenario];
                const kicks = replay(fixture.frames, settings);
                const result = score(fixture.onsets, kicks.map(k => k.time));
                rows.push({ name: scenario, onsets: fixture.onsets.length, kicks: kicks.length, result });
                assert.deepEqual(overBudget(result, budget), [], `${scenario} at ${config}: ${fixture.about}`);
            });
        }
        after(() => console.log(report(`\n${config}: ${JSON.stringify(settings)}`, rows)));
    });
}

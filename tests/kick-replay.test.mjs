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

// Measured result per track, not a target: #6's detector (jumps measured against the kick range's
// recent peak, re-armed as in v0.4.1) on the bands cava puts 30-90 Hz in, replayed on these
// recordings on 2026-10-29. Before #6 (v0.4.1's absolute threshold): 48 wrong kicks at the defaults
// (loud_quiet missed 23, zoo1 and zoo2 6 each), 82 at the sensitive config. latency is the median
// onset-to-kick delay in ms. A change may only lower a budget. One that has to raise a budget says
// why, with numbers, in its PR.
const BUDGETS = {
    defaults: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency:  83 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  86 },
        sustained_bass: { missed:  1, doubled:  0, stray:  1, latency:  87 },
        // The first two kicks after the 12 dB drop, while the peak releases.
        loud_quiet:     { missed:  2, doubled:  0, stray:  0, latency:  85 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency:  67 },
        double_kick:    { missed: 11, doubled:  0, stray:  0, latency:  87 },
        zoo1:           { missed:  1, doubled:  0, stray:  0, latency:  94 },
        zoo2:           { missed:  1, doubled:  0, stray:  0, latency: 101 },
        zoo3:           { missed:  0, doubled:  0, stray:  0, latency: 105 },
    },
    sensitive: {
        kick_only:      { missed:  1, doubled:  0, stray:  0, latency:  72 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  76 },
        sustained_bass: { missed:  1, doubled: 26, stray: 17, latency:  49 },
        loud_quiet:     { missed:  1, doubled:  0, stray:  0, latency:  72 },
        dnb_808:        { missed:  0, doubled:  0, stray: 15, latency:  56 },
        double_kick:    { missed: 11, doubled:  0, stray:  0, latency:  77 },
        zoo1:           { missed:  1, doubled:  0, stray:  1, latency:  83 },
        // zoo2 and zoo3 went up with #6 (missed 1 -> 3 and 2 -> 4, doubled 0 -> 1 each), all through
        // v0.4.1's re-arm, which waits for a frame in which no band jumps by half the threshold. As a
        // kick's pitch falls through bands 3 to 1, its jump against the peak stays above 0.1 (zoo2
        // at 2.39-2.49 s: 0.19-0.21; zoo3 at 13.15 s: down to 0.100), so the detector stays disarmed
        // through the next onset. Each double is two kicks with a one-frame dip of the jump between
        // them (zoo2 at 17.99 and 18.09 s, zoo3 at 13.59 and 13.70 s). #7 replaces this re-arm.
        zoo2:           { missed:  3, doubled:  1, stray:  0, latency:  86 },
        zoo3:           { missed:  4, doubled:  1, stray:  0, latency:  97 },
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

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

// Measured result per track, not a target: #7's detector (jumps measured against the kick range's
// recent peak, one kick per hit) on the bands cava puts 30-90 Hz in, replayed on these recordings on
// 2026-10-29. Before #7 (re-armed once no band jumped by half the threshold for a frame): 17 wrong
// kicks at the defaults, 83 at the sensitive config (28 doubled, 33 stray). latency is the median
// onset-to-kick delay in ms. A change may only lower a budget. One that has to raise a budget says
// why, with numbers, in its PR.
const BUDGETS = {
    defaults: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency:  83 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  86 },
        // The stray is the drone coming in at 1.5 s.
        sustained_bass: { missed:  0, doubled:  0, stray:  1, latency:  86 },
        // The first two kicks after the 12 dB drop, while the peak releases.
        loud_quiet:     { missed:  2, doubled:  0, stray:  0, latency:  85 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency:  67 },
        // Latency went up with #7 (87 -> 89 ms): 8 of the 11 quarter kicks right after a 16th now fire,
        // 100-130 ms after their onset, while the 16th still rings in the same bands.
        double_kick:    { missed:  3, doubled:  0, stray:  0, latency:  89 },
        // zoo1 and zoo2 went up with #7 (missed 1 -> 2 each), at kicks that come while the last one
        // still rings and rise less than kickThreshold above it. zoo1 at 22.81 s: the kick before rings
        // on in band 4 at 0.6 of the peak, the new one is pitched lower, and its bands above 4 rise by
        // only 0.25-0.33. zoo2 at 17.97 s: a soft kick (0.44 of the peak) whose bands above the last
        // kick's rise by 0.35-0.39, and the level stays under half the last kick's top for 0.17 s
        // before it, short of the 0.2 s that ends a hit. The old re-arm caught both.
        zoo1:           { missed:  2, doubled:  0, stray:  0, latency:  93 },
        zoo2:           { missed:  2, doubled:  0, stray:  0, latency: 100 },
        zoo3:           { missed:  0, doubled:  0, stray:  0, latency: 105 },
    },
    sensitive: {
        kick_only:      { missed:  0, doubled:  0, stray:  0, latency:  72 },
        steady_house:   { missed:  0, doubled:  0, stray:  0, latency:  76 },
        // Latency went up with #7 (49 -> 78 ms), as the doubles went (26 -> 0). The old 49 ms were
        // kicks fired by the drone beating against the last kick's tail in band 2, which landed just
        // after the next onset by chance, before cava showed that kick: all 31 kicks that fired less
        // than 65 ms after an onset fired in band 2. Now each onset fires once, when its kick shows.
        sustained_bass: { missed:  0, doubled:  0, stray:  1, latency:  78 },
        loud_quiet:     { missed:  0, doubled:  0, stray:  0, latency:  71 },
        dnb_808:        { missed:  0, doubled:  0, stray:  0, latency:  56 },
        // Latency went up with #7 (77 -> 79 ms), see the defaults.
        double_kick:    { missed:  3, doubled:  0, stray:  0, latency:  79 },
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

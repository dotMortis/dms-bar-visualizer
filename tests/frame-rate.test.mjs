// The visualizer gets cava's 60 frames per second, the demo pushes one frame per display refresh.
// Replays every fixture with its frames repeated the way a faster display shows them, and holds the
// detector to the kicks it fires at 60 fps.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONFIGS, FIXTURES, SCENARIOS, atFrameRate, replay } from "./replay.mjs";

// One cava frame: the fixtures' frames are 16.4 to 16.9 ms apart.
const FRAME = 0.017;

// The kicks with no kick of the other list within a frame.
function unmatched(kicks, others) {
    return kicks.filter(t => !others.some(o => Math.abs(o - t) <= FRAME));
}

const at = times => times.map(t => t.toFixed(3)).join(", ");

for (const fps of [120, 144]) {
    for (const [config, settings] of Object.entries(CONFIGS)) {
        describe(`at ${fps} Hz, ${config}`, () => {
            for (const scenario of SCENARIOS) {
                test(`${scenario} fires the kicks it fires at 60 fps, within a frame`, () => {
                    const { frames } = FIXTURES[scenario];
                    const at60 = replay(frames, settings).map(k => k.time);
                    const atFps = replay(atFrameRate(frames, fps), settings).map(k => k.time);
                    const missing = unmatched(at60, atFps), extra = unmatched(atFps, at60);
                    assert.deepEqual(missing, [], `kicks at 60 fps that don't fire at ${fps} Hz: ${at(missing)} s`);
                    assert.deepEqual(extra, [], `kicks only at ${fps} Hz: ${at(extra)} s`);
                    assert.equal(atFps.length, at60.length, "kicks at 60 fps fire more than once");
                });
            }
        });
    }
}

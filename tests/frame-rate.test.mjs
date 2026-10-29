// The visualizer gets cava's 60 frames per second, the demo pushes one frame per display refresh.
// Replays every fixture with its frames repeated the way a faster display shows them, and holds the
// detector to the kicks it fires at 60 fps.
import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import { atFrameRate, readFixture, replay } from "./replay.mjs";

const CONFIGS = {
    defaults: { kickThreshold: 0.4, kickLowHz: 30, kickHighHz: 90, kickCooldown: 0.12 },
    sensitive: { kickThreshold: 0.2, kickLowHz: 30, kickHighHz: 90, kickCooldown: 0.1 },
};
const SCENARIOS = fs.readdirSync(new URL("fixtures/", import.meta.url))
    .filter(f => f.endsWith(".txt")).map(f => f.slice(0, -4)).sort();
// One cava frame: the fixtures' frames are 16.4 to 16.9 ms apart.
const FRAME = 0.017;

// Kicks that fire at 120 and 144 Hz but not at 60 fps, measured on 2026-10-29. The detector
// re-arms once a frame's jump falls under half the threshold, and while a frame is repeated its
// jump keeps shrinking towards the running average. Both are re-arms the 60 fps replay misses by a
// hair: sustained_bass at 12.80 s jumps 0.104 at 60 fps and 0.100 on the repeat, zoo2 at 9.79 s
// 0.102 and 0.098, against 0.1. A change may only lower these.
const EXTRA = {
    sensitive: { sustained_bass: 1, zoo2: 1 },
};

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
                    const { frames } = readFixture(scenario);
                    const at60 = replay(frames, settings).map(k => k.time);
                    const atFps = replay(atFrameRate(frames, fps), settings).map(k => k.time);
                    const missing = unmatched(at60, atFps), extra = unmatched(atFps, at60);
                    const allowed = EXTRA[config]?.[scenario] ?? 0;
                    assert.deepEqual(missing, [], `kicks at 60 fps that don't fire at ${fps} Hz: ${at(missing)} s`);
                    assert.ok(extra.length <= allowed, `kicks only at ${fps} Hz: ${at(extra)} s (${allowed} allowed)`);
                    assert.equal(atFps.length, at60.length + extra.length, "kicks at 60 fps fire more than once");
                });
            }
        });
    }
}

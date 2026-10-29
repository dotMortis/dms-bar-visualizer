// kickLowHz and kickHighHz select the cava bands that actually contain those frequencies. Checked
// against a stepped sine sweep recorded through real cava (fixtures/record.py, scenario "tones").
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createKickDetector } from "../docs/kick.mjs";
import { readFixture } from "./replay.mjs";

// The band the detector listens to when the kick range is just this frequency.
function bandOf(hz) {
    return createKickDetector({ kickThreshold: 0.4, kickCooldown: 0.12, kickLowHz: hz, kickHighHz: hz }).bands.from;
}

// cava's bass FFT spans 186 ms (8192 samples at 44.1 kHz). From 0.2 s into a tone until it ends,
// cava sees nothing else.
const SETTLE = 0.2;

// The band cava lit up most during a tone: the highest mean over its settled frames.
function loudestBand(frames, { at, length }) {
    const settled = frames.filter(({ time }) => time >= at + SETTLE && time <= at + length);
    const mean = settled[0].values.map((_, i) => settled.reduce((sum, { values }) => sum + values[i], 0) / settled.length);
    return mean.indexOf(Math.max(...mean));
}

// A tone this close to a band edge may land in either neighbour.
const EDGE = 0.03;

describe("band mapping", () => {
    const sweep = readFixture("tones");

    test("every tone of the sweep maps to the band cava lit up most", () => {
        const wrong = [];
        for (const tone of sweep.tones) {
            const cava = loudestBand(sweep.frames, tone);
            const near = [tone.hz * (1 - EDGE), tone.hz, tone.hz * (1 + EDGE)].map(bandOf);
            if (!near.includes(cava))
                wrong.push(`${tone.hz} Hz: cava band ${cava}, mapped to ${bandOf(tone.hz)}`);
        }
        assert.deepEqual(wrong, [], `${wrong.length} of ${sweep.tones.length} tones in the wrong band`);
    });

    test("35, 40, 50 and 90 Hz map to the bands cava puts them in", () => {
        // Spec #1 measured these with sine tones through cava; a plain log scale puts them in bands
        // 0, 1, 2 and 5. The sweep has the same four tones and no slack for them.
        const cava = { 35: 1, 40: 2, 50: 3, 90: 6 };
        const tones = Object.keys(cava).map(hz => sweep.tones.find(tone => tone.hz === Number(hz)));
        const recorded = Object.fromEntries(tones.map(tone => [tone.hz, loudestBand(sweep.frames, tone)]));
        const mapped = Object.fromEntries(tones.map(tone => [tone.hz, bandOf(tone.hz)]));
        assert.deepEqual(recorded, cava);
        assert.deepEqual(mapped, cava);
    });

    test("the kick range listens to every band from kickLowHz's up to and including kickHighHz's", () => {
        // The defaults, 30 to 90 Hz: cava puts 30 Hz in band 0 and 90 Hz in band 6.
        const detector = createKickDetector({ kickThreshold: 0.4, kickCooldown: 0.12, kickLowHz: 30, kickHighHz: 90 });
        assert.deepEqual(detector.bands, { from: 0, to: 7 });
    });

    test("frequencies outside cava's 30 Hz to 14 kHz select its first and last band", () => {
        for (const [low, high] of [[10, 20000], [0, 22050], [-5, 1e6]]) {
            const detector = createKickDetector({ kickThreshold: 0.4, kickCooldown: 0.12, kickLowHz: low, kickHighHz: high });
            assert.deepEqual(detector.bands, { from: 0, to: 32 }, `${low} to ${high} Hz`);
        }
    });
});

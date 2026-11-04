// The Lock Ring's look, apart from drawing: where on the ring each part of the spectrum sits, and
// how the ring swells with the music and fades back to the faint dial in silence.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRingMotion, spectrumAt } from "../lock-ring/ring.mjs";

const near = (actual, expected, msg) => assert.ok(Math.abs(actual - expected) < 1e-9, `${msg ?? ""} ${actual} != ${expected}`);

// Angles are clockwise degrees from 12 o'clock, like the hands. Spectrum positions run from 0
// (lowest band) to 1 (highest).
describe("spectrum around the ring", () => {
    test("bass sits at the bottom, at 6 o'clock", () => {
        near(spectrumAt(180, 1.4), 0);
    });

    test("the highs meet at the top, at 12 o'clock", () => {
        near(spectrumAt(0, 1.4), 1);
        near(spectrumAt(360, 1.4), 1);
    });

    test("left and right are mirror images", () => {
        for (const angle of [10, 45, 90, 135, 170])
            near(spectrumAt(angle, 1.4), spectrumAt(360 - angle, 1.4), `${angle} vs ${360 - angle}:`);
    });

    test("without bass stretch, 3 and 9 o'clock show the middle of the spectrum", () => {
        near(spectrumAt(90, 1), 0.5);
        near(spectrumAt(270, 1), 0.5);
    });

    test("bass stretch gives the bass more of the ring, like the bar's bassStretch", () => {
        // Halfway up the ring the spectrum is still a fifth short of its middle at 1.4.
        near(spectrumAt(90, 1.4), 0.5 ** 1.4);
    });

    test("the spectrum climbs from the bottom to the top on each side", () => {
        for (let angle = 180; angle > 0; angle -= 5)
            assert.ok(spectrumAt(angle - 5, 1.4) > spectrumAt(angle, 1.4), `right side at ${angle}`);
        for (let angle = 180; angle < 360; angle += 5)
            assert.ok(spectrumAt(angle + 5, 1.4) > spectrumAt(angle, 1.4), `left side at ${angle}`);
    });
});

// Feeds `levels` (bass, mid, treble on cava's 0..1 scale) for `seconds` at 60 fps, returning
// the last frame.
function play(motion, levels, seconds) {
    let frame;
    for (let t = 0; t < seconds; t += 1 / 60)
        frame = motion.step(levels, 1 / 60);
    return frame;
}

const silence = { bass: 0, mid: 0, treble: 0 };
const music = { bass: 0.6, mid: 0.4, treble: 0.3 };

describe("ring motion", () => {
    test("in silence the ring is the faint dial: no ribbons, no swell", () => {
        assert.deepEqual(play(createRingMotion(), silence, 1), { swell: 0, presence: 0 });
    });

    test("when the music starts, the ribbons show within a quarter second and the ring swells", () => {
        const { swell, presence } = play(createRingMotion(), music, 0.25);
        assert.ok(presence > 0.9, `presence ${presence}`);
        assert.ok(swell > 0, `swell ${swell}`);
    });

    test("louder music swells the ring more", () => {
        const quiet = play(createRingMotion(), { bass: 0.2, mid: 0.1, treble: 0.1 }, 0.5).swell;
        const loud = play(createRingMotion(), { bass: 0.9, mid: 0.6, treble: 0.4 }, 0.5).swell;
        assert.ok(loud > quiet * 2, `loud ${loud}, quiet ${quiet}`);
    });

    test("the swell follows a beat: up on the hit and back down before the next one", () => {
        const motion = createRingMotion();
        play(motion, { bass: 0.1, mid: 0.1, treble: 0.1 }, 1);
        const before = motion.step({ bass: 0.1, mid: 0.1, treble: 0.1 }, 1 / 60).swell;
        const hit = play(motion, { bass: 1, mid: 0.4, treble: 0.2 }, 0.1).swell;
        const after = play(motion, { bass: 0.1, mid: 0.1, treble: 0.1 }, 0.4).swell;
        assert.ok(hit > before * 3, `hit ${hit}, before ${before}`);
        assert.ok(after < before * 1.2, `after ${after}, before ${before}`);
    });

    test("at full scale the ring swells by at most a tenth of the dial, so it stays in the widget", () => {
        const { swell } = play(createRingMotion(), { bass: 1, mid: 1, treble: 1 }, 2);
        assert.ok(swell > 0.05 && swell <= 0.1, `swell ${swell}`);
    });

    test("when the music stops, the ring is back to the faint dial within 1.5 s", () => {
        const motion = createRingMotion();
        play(motion, music, 3);
        const { swell, presence } = play(motion, silence, 1.5);
        assert.ok(presence < 0.02, `presence ${presence}`);
        assert.ok(swell < 0.002, `swell ${swell}`);
    });
});

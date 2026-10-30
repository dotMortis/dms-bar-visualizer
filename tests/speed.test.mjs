// speed scales the animation clock: kickCooldown runs on it, the smoothing runs on real time.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONFIGS, FIXTURES, SCENARIOS, replay } from "./replay.mjs";

const SENSITIVE = CONFIGS.sensitive;

describe("speed", () => {
    test("kickCooldown is in animation seconds: at speed 2 it lasts half as long", () => {
        for (const scenario of SCENARIOS) {
            const { frames } = FIXTURES[scenario];
            assert.deepEqual(
                replay(frames, { ...SENSITIVE, kickCooldown: 0.3, speed: 2 }),
                replay(frames, { ...SENSITIVE, kickCooldown: 0.15, speed: 1 }), scenario);
        }
    });

    test("kickCooldown is in animation seconds: at speed 0.5 it lasts twice as long", () => {
        for (const scenario of SCENARIOS) {
            const { frames } = FIXTURES[scenario];
            assert.deepEqual(
                replay(frames, { ...SENSITIVE, kickCooldown: 0.06, speed: 0.5 }),
                replay(frames, { ...SENSITIVE, kickCooldown: 0.12, speed: 1 }), scenario);
        }
    });

    test("at speed 0 the cooldown never runs out, so only the first kick fires", () => {
        const { frames } = FIXTURES.kick_only;
        assert.equal(replay(frames, { ...SENSITIVE, speed: 0 }).length, 1);
    });

    test("speed doesn't change how fast the smoothing follows the music", () => {
        // Without a cooldown, speed has nothing left to change.
        for (const scenario of SCENARIOS) {
            const { frames } = FIXTURES[scenario];
            const atSpeed1 = replay(frames, { ...SENSITIVE, kickCooldown: 0, speed: 1 });
            for (const speed of [0, 0.5, 2])
                assert.deepEqual(replay(frames, { ...SENSITIVE, kickCooldown: 0, speed }), atSpeed1, `${scenario} at speed ${speed}`);
        }
    });
});

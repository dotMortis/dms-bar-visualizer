// Silence (GLOSSARY.md): no Active Player, the Active Player paused, or it playing but its output
// silent. The audio pipeline (audio/AudioPipeline.qml) asks audio/silence.mjs which case applies and
// whether its capture runs; these tests replay player events and band frames (or none at all, as
// cava sends none once its sleep_timer stops it) through it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HOLD, THRESHOLD, capturing, createSilence } from "../audio/silence.mjs";

// Replays [time (s), event] pairs as the pipeline sees them: "none" (no Active Player), "play" and
// "pause" (the Active Player's isPlaying, on the same object), "loud"/"quiet" (one frame of bands:
// one band at 0.5, or all at 0), "tick" (the pipeline's clock, no frame). After each event the
// pipeline asks again; returns [case, capture runs] after each.
function replay(events) {
    const silence = createSilence();
    const player = { identity: "spotify", isPlaying: false };
    let active = player;
    return events.map(([time, what]) => {
        if (what === "none")
            active = null;
        else if (what === "play")
            (active = player).isPlaying = true;
        else if (what === "pause")
            (active = player).isPlaying = false;
        else if (what === "loud")
            silence.frame([0, 0.5, ...new Array(30).fill(0)], time);
        else if (what === "quiet")
            silence.frame(new Array(32).fill(0), time);
        return [silence.check(active, time), capturing(active)];
    });
}

describe("Silence", () => {
    test("is no-player without an Active Player, and nothing captures", () => {
        assert.deepEqual(replay([[0, "none"], [10, "tick"]]), [["no-player", false], ["no-player", false]]);
    });

    test("is paused while the Active Player is paused, and nothing captures", () => {
        assert.deepEqual(replay([[0, "pause"], [10, "tick"]]), [["paused", false], ["paused", false]]);
    });

    test("is none while the Active Player plays and its output sounds, and the capture runs", () => {
        assert.deepEqual(replay([[0, "play"], [0.5, "loud"], [1.5, "loud"], [3, "loud"], [4.5, "loud"]]),
            [["", true], ["", true], ["", true], ["", true], ["", true]]);
    });

    test("is silent once the bands stay below the threshold for the hold time, and the capture keeps running", () => {
        assert.deepEqual(replay([[0, "play"], [1, "loud"], [1.5, "quiet"], [1 + HOLD - 0.1, "quiet"], [1 + HOLD, "quiet"], [1 + HOLD + 5, "quiet"]]),
            [["", true], ["", true], ["", true], ["", true], ["silent", true], ["silent", true]]);
    });

    test("is silent after the hold time with no frames at all, as cava sends none once its sleep_timer stops it", () => {
        assert.deepEqual(replay([[0, "play"], [1, "loud"], [1 + HOLD - 0.1, "tick"], [1 + HOLD, "tick"], [60, "tick"]]),
            [["", true], ["", true], ["", true], ["silent", true], ["silent", true]]);
    });

    test("counts the hold time from the start of playing when no frame came yet", () => {
        assert.deepEqual(replay([[10, "pause"], [20, "play"], [20 + HOLD - 0.1, "tick"], [20 + HOLD, "tick"]]),
            [["paused", false], ["", true], ["", true], ["silent", true]]);
    });

    test("ends on the first sound, with the capture never stopped", () => {
        assert.deepEqual(replay([[0, "play"], [30, "tick"], [31, "loud"], [31.1, "quiet"]]),
            [["", true], ["silent", true], ["", true], ["", true]]);
    });

    test("goes from playing to paused to no player and back, the capture following", () => {
        assert.deepEqual(replay([[0, "play"], [1, "loud"], [2, "pause"], [30, "none"], [40, "play"], [40.5, "loud"]]),
            [["", true], ["", true], ["paused", false], ["no-player", false], ["", true], ["", true]]);
    });

    test("treats bands just under the threshold as silent and at it as sound", () => {
        const silence = createSilence();
        const player = { isPlaying: true };
        silence.check(player, 0);
        silence.frame(new Array(32).fill(THRESHOLD * 0.99), 1);
        assert.equal(silence.check(player, HOLD), "silent");
        silence.frame([THRESHOLD, ...new Array(31).fill(0)], HOLD + 1);
        assert.equal(silence.check(player, HOLD + 1), "");
    });
});

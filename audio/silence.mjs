// Silence (GLOSSARY.md), as plain ECMAScript that QML and node both load, so node tests can replay
// it: which of its three cases applies, and whether the capture runs.
// audio/AudioPipeline.qml calls it; lock-ring/audio/ links here, next to its link to the pipeline.

// "Silent output": every band (0..1, as docs/kick.mjs parseBands gives them) below THRESHOLD for
// HOLD seconds. Provisional; the harness refines them.
export const THRESHOLD = 0.02;
export const HOLD = 2;

// Whether the capture runs for `player` (the Active Player, null for none): only while it plays.
// A playing but silent player keeps it, so the first sound after the silence is caught.
export function capturing(player) {
    return !!player && player.isPlaying;
}

// Tracks the Silence case. frame(bands, now) with each frame of bands; check(player, now) whenever
// the Active Player or its isPlaying changes, after each frame, and on a clock while it plays
// without sound, since cava sends no frames at all once its sleep_timer stops it. `now` in seconds.
// check returns the case: "no-player", "paused", "silent", or "" (not Silence).
export function createSilence() {
    let playing = false;
    let soundAt = 0;  // when the output last sounded, or the player started playing
    return {
        frame(bands, now) {
            if (bands.some(b => b >= THRESHOLD))
                soundAt = now;
        },
        check(player, now) {
            const wasPlaying = playing;
            playing = capturing(player);
            if (!player)
                return "no-player";
            if (!playing)
                return "paused";
            if (!wasPlaying)
                soundAt = now;
            return now - soundAt >= HOLD ? "silent" : "";
        },
    };
}

// The harness's cheap check: the replayed input really reaches the visualizer. Live Kicks from a
// run, timed from the run's epoch (when the measured window starts and the track is at its first
// frame), are matched loop by loop to the Kicks the kick-replay tests expect for the track.
//
//   node harness/kicks.mjs <kick log> <loops> [track]   checks a log of "KICK <s since epoch> <power>"
//   lines; exits 1 if any loop's Kicks are off
import fs from "node:fs";

import { CONFIGS, FIXTURES, replay } from "../tests/replay.mjs";

// The track every scenario with music plays: Kicks, bassline and hats, so every band group has
// work, and the same all the way through, so any window of it costs about the same.
export const REFERENCE_TRACK = "steady_house";

// A fixture as the harness's fake cava replays it, looping: its length (first frame to one frame
// past the last) and the Kicks the replay tests expect at the default settings, in s into the track.
export function replayTrack(name) {
    const { frames } = FIXTURES[name];
    const first = frames[0].time;
    const length = frames.at(-1).time - first + (frames[1].time - first);
    const expected = replay(frames, CONFIGS.defaults).map(({ time }) => time - first);
    return { length, expected };
}

// Live Kick times (s since the epoch) against the expected ones (s into the track, one loop of
// `length` s), over `loops` whole loops; Kicks outside them (warm-up, after the window) don't count.
// Each expected Kick takes the nearest unclaimed live one within `tolerance` s. Per loop: the live
// Kicks, the expected ones with none (missed), the live ones left over (extra), and the worst offset
// of a matched one in ms.
export function checkKicks(live, { expected, length, loops, tolerance = 1 / 30 }) {
    const perLoop = [];
    for (let loop = 0; loop < loops; loop++) {
        const times = live.filter(t => t >= loop * length && t < (loop + 1) * length).map(t => t - loop * length);
        const claimed = new Set();
        let missed = 0, worst = 0;
        for (const want of expected) {
            let best = -1;
            times.forEach((t, i) => {
                if (!claimed.has(i) && Math.abs(t - want) <= tolerance && (best < 0 || Math.abs(t - want) < Math.abs(times[best] - want)))
                    best = i;
            });
            if (best < 0) {
                missed++;
                continue;
            }
            claimed.add(best);
            worst = Math.max(worst, Math.abs(times[best] - want));
        }
        perLoop.push({ loop, kicks: times.length, missed, extra: times.length - claimed.size, worstMs: Math.round(worst * 1000) });
    }
    return { ok: perLoop.every(l => !l.missed && !l.extra), loops: perLoop };
}

if (import.meta.main) {
    const [log, loops, name = REFERENCE_TRACK] = process.argv.slice(2);
    const live = fs.readFileSync(log, "utf8").split("\n")
        .map(line => line.match(/KICK (-?[\d.]+)/)).filter(Boolean).map(m => Number(m[1]));
    const result = checkKicks(live, { ...replayTrack(name), loops: Number(loops) });
    for (const l of result.loops)
        console.log(`kicks loop ${l.loop}: ${l.kicks} live, ${l.missed} missed, ${l.extra} extra, worst ${l.worstMs} ms`);
    console.log(`kicks ${result.ok ? "OK" : "FAILED"}: ${replayTrack(name).expected.length} expected per loop (${name})`);
    process.exitCode = result.ok ? 0 : 1;
}

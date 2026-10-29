// cava's autosens rescales its output all the time and takes over 10 s to catch up after a loud
// passage, so the same kick can come out of cava at very different levels. kickThreshold is a
// fraction of the kick range's recent peak, so it means the same at any level.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { CONFIGS, FIXTURES, SCENARIOS, TRACKS, replay, score } from "./replay.mjs";

// The frames with every band scaled by gain, as if cava showed the music that much quieter.
const scaled = (frames, gain) => frames.map(({ time, values }) => ({ time, values: values.map(v => v * gain) }));

const kicksAt = kicks => kicks.map(({ time, power }) => `${time.toFixed(3)} s, power ${power.toFixed(6)}`);

describe("kickThreshold is relative to the recent peak", () => {
    for (const [config, settings] of Object.entries(CONFIGS)) {
        test(`at ${config}, music 6 or 12 dB quieter fires the same kicks with the same power`, () => {
            for (const scenario of SCENARIOS) {
                const { frames } = FIXTURES[scenario];
                const kicks = replay(frames, settings);
                for (const [db, gain] of [[6, 0.5], [12, 0.25]]) {
                    // Apart from the first kick out of silence: before the music has set a peak,
                    // a fixed floor decides what counts as silence, so quieter music fires it a
                    // frame or two later.
                    assert.deepEqual(kicksAt(replay(scaled(frames, gain), settings).slice(1)), kicksAt(kicks.slice(1)),
                        `${scenario}, ${db} dB quieter`);
                }
            }
        });

        test(`at ${config}, kicks come back within 1.5 s after the music drops by 12 dB`, () => {
            // v0.4.1 missed all 23 kicks after the drop at the defaults: autosens was still scaled
            // for the loud part, so the quieter kicks never jumped by kickThreshold.
            const { onsets, frames } = FIXTURES.loud_quiet;
            const drop = 12;  // see the scenario in fixtures/record.py
            const { missed } = score(onsets, replay(frames, settings).map(k => k.time));
            assert.deepEqual(missed.filter(t => t > drop + 1.5), [], `missed onsets after the drop at ${drop} s`);
        });

        test(`at ${config}, kicks come back within 2 s after cava restarts`, () => {
            // The visualizer restarts cava when the player or output changes, which resets autosens,
            // so the new cava's kicks can come out well below the peak the old one left behind.
            // Every recording, cut just after its last kick, is followed 0.25 s later by every
            // recording from just before its first kick: autosens doesn't move in the silence each
            // recording starts with, so from there it is what a freshly started cava shows. The
            // second one also 6 dB quieter, as when the new music's loudest bands (which autosens
            // scales to) are outside the kick range. From 2 s after the restart on, the joined replay
            // must catch every onset that a detector fed only the second recording catches.
            for (const before of TRACKS) {
                const last = FIXTURES[before];
                const cut = last.onsets.at(-1) + 0.15;
                const head = last.frames.filter(f => f.time <= cut);
                for (const after of TRACKS) {
                    const next = FIXTURES[after];
                    const start = next.onsets[0] - 0.1;
                    for (const [db, gain] of [[0, 1], [6, 0.5]]) {
                        const fresh = scaled(next.frames.filter(f => f.time >= start), gain);
                        const shift = head.at(-1).time + 0.25 - start;  // fresh's clock to the joined one
                        const joined = [...head, ...fresh.map(({ time, values }) => ({ time: time + shift, values }))];
                        const kicks = replay(joined, settings).map(k => k.time - shift).filter(t => t >= start);
                        const caught = score(next.onsets, replay(fresh, settings).map(k => k.time)).missed;
                        const lost = score(next.onsets, kicks).missed.filter(t => t >= start + 2 && !caught.includes(t));
                        assert.deepEqual(lost, [], `${before} then ${after}${db ? `, ${db} dB quieter` : ""}: onsets missed after the restart`);
                    }
                }
            }
        });
    }
});

// The shader scales a kick's shockwave and particles by its power; 0 marks an empty slot.
describe("kick power", () => {
    test("stays within 0.5 to 1 at any kickThreshold", () => {
        for (const kickThreshold of [0, 0.1, 0.2, 0.4, 0.6, 0.8]) {
            for (const scenario of SCENARIOS) {
                const powers = replay(FIXTURES[scenario].frames, { ...CONFIGS.defaults, kickThreshold }).map(k => k.power);
                const out = powers.filter(p => !(p >= 0.5 && p <= 1));
                assert.deepEqual(out, [], `${scenario} at kickThreshold ${kickThreshold}`);
            }
        }
    });

    for (const [config, settings] of Object.entries(CONFIGS)) {
        test(`at ${config}, a hit louder than the recent kicks fires at full power, steady ones weaker`, () => {
            // A steady beat, then 12 dB louder from one hit on. The steady kicks (once the start is
            // 2 s behind) all hit as hard as the ones before them, so none reaches full power.
            for (const scenario of ["kick_only", "steady_house"]) {
                const { onsets, frames } = FIXTURES[scenario];
                const step = onsets.find(t => t > 12) - 0.03;
                const louderFrom = frames.map(f => f.time < step ? { ...f, values: f.values.map(v => v * 0.25) } : f);
                const kicks = replay(louderFrom, settings);
                const steady = kicks.filter(k => k.time > 4 && k.time < step);
                const louder = kicks.find(k => k.time > step);
                assert.ok(steady.length > 10 && steady.every(k => k.power < 1), `${scenario}, steady: ${kicksAt(steady)}`);
                assert.equal(louder.power, 1, `${scenario}, first kick 12 dB louder: ${kicksAt([louder])}`);
            }
        });

        test(`at ${config}, a hit quieter than the recent kicks fires weaker`, () => {
            // The first kick after the 12 dB drop in loud_quiet against the ones before the drop.
            const kicks = replay(FIXTURES.loud_quiet.frames, settings);
            const before = kicks.filter(k => k.time > 4 && k.time < 12).map(k => k.power).sort((a, b) => a - b);
            const quieter = kicks.find(k => k.time > 12);
            assert.ok(quieter.power < before[before.length >> 1],
                `first kick after the drop ${kicksAt([quieter])}, median before ${before[before.length >> 1]}`);
        });

        test(`at ${config}, a band that can't fire a kick doesn't add to its power`, () => {
            // A hit at 1 s rings on in band 1 and dies down in bands 2-6. At 1.25 s a new one comes
            // in, in band 4, above where the last one rings. Band 0, below it, can't fire a kick:
            // whether it jumps at the same time or not, the kick is the same.
            const hits = band0 => Array.from({ length: 1.5 * 60 }, (_, n) => {
                const time = n / 60, values = new Array(32).fill(0);
                if (time >= 1) {
                    values[1] = 0.8;
                    for (let i = 2; i <= 6; i++)
                        values[i] = 0.1 + 0.65 * Math.exp(-(time - 1) / 0.04);
                }
                if (time >= 1.25) {
                    values[4] = 0.6;
                    values[0] = band0;
                }
                return { time, values };
            });
            const alone = replay(hits(0), settings);
            assert.deepEqual(alone.map(k => k.time), [1, 1.25]);
            assert.deepEqual(kicksAt(replay(hits(0.7), settings)), kicksAt(alone));
        });
    }
});

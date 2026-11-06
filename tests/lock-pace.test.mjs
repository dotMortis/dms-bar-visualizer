// In Silence the Lock Ring keeps its breathing idle wave, but draws it at a low, fixed frame rate
// (lock-ring/pace.mjs), so a locked, quiet machine is nearly idle. It slows down only once the
// music has played out on the ring, and the first sound brings the full frame rate back at once.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { PLAYED_OUT } from "../lock-ring/kicks.mjs";
import { atRest, drawsSlowly, restingMusic, SILENCE_FPS } from "../lock-ring/pace.mjs";
import { createRingMotion, IDLE, ribbonRadius } from "../lock-ring/ring.mjs";

// The ring with the music played out: only its idle wave left.
const calm = { presence: 0, swell: 0, kick: 0, kickAges: [], kickPowers: [], words: {} };

describe("Lock Ring pace", () => {
    test("with something to hear it draws every frame, however calm the ring is", () => {
        assert.equal(drawsSlowly("", true), false);
    });

    test("in each Silence case, once the ring is at rest, it draws slowly", () => {
        for (const silence of ["no-player", "paused", "silent"])
            assert.equal(drawsSlowly(silence, true), true, silence);
    });

    test("in Silence it keeps every frame while the music is still playing out on the ring", () => {
        assert.equal(drawsSlowly("paused", false), false);
    });

    test("the ring with only its idle wave left is at rest", () => {
        assert.equal(atRest(calm), true);
    });

    test("it isn't at rest while the music still plays out on it", () => {
        const playingOut = {
            "the ribbons still show the music": { presence: 0.2 },
            "the ring still swells": { swell: 0.03 },
            "the Kick's punch still fades": { kick: 0.3 },
            "a Shockwave is still on its way": { kickAges: [1], kickPowers: [0.8] },
            "a Lyric Word still pops in": { words: { a: { popIn: 0.5, dissolve: 0 } } },
            "a Lyric Line still dissolves": { words: { a: { popIn: 1, dissolve: 0.4 } } },
        };
        for (const [what, state] of Object.entries(playingOut))
            assert.equal(atRest(Object.assign({}, calm, state)), false, what);
    });

    test("Lyric Words standing still don't hold it: landed and whole, or paused (the words stop with the song)", () => {
        assert.equal(atRest(Object.assign({}, calm, { silence: "silent", words: { a: { popIn: 1, dissolve: 0 } } })), true);
        for (const silence of ["paused", "no-player"]) {
            const words = { a: { popIn: 0.5, dissolve: 0 }, b: { popIn: 1, dissolve: 0.4 } };
            assert.equal(atRest(Object.assign({}, calm, { silence, words })), true, silence);
        }
    });

    test("a Kick that has played out doesn't hold it", () => {
        assert.equal(atRest(Object.assign({}, calm, { kickAges: [PLAYED_OUT + 0.1, 50], kickPowers: [1, 0.5] })), true);
    });

    test("when the music stops, the ring is at rest within 2 s, and not before the ribbons have faded", () => {
        const motion = createRingMotion();
        const dt = 1 / 60;
        for (let t = 0; t < 3; t += dt)
            motion.step({ bass: 0.8, mid: 0.6, treble: 0.4 }, dt);
        let rested = null;
        for (let t = dt; t < 4; t += dt) {
            const m = motion.step({ bass: 0, mid: 0, treble: 0 }, dt);
            if (atRest(Object.assign({}, calm, m))) {
                rested = t;
                break;
            }
        }
        assert.ok(rested !== null && rested <= 2, `at rest after ${rested} s`);
        assert.ok(rested >= 0.5, `at rest after only ${rested} s, with the ribbons still fading`);
    });

    test("in Silence it draws at a low, fixed frame rate", () => {
        assert.ok(Number.isInteger(SILENCE_FPS) && SILENCE_FPS > 0 && SILENCE_FPS <= 15, `${SILENCE_FPS} fps`);
    });

    test("at that rate the idle wave still moves every frame, in steps too small to see as jumps", () => {
        for (const time of [0, 7.3, 600]) {
            for (const angle of [0, 45, 180, 290]) {
                const step = Math.abs(ribbonRadius(angle, { time: time + 1 / SILENCE_FPS }) - ribbonRadius(angle, { time }));
                assert.ok(step < IDLE.reach * 0.2, `${step} at ${angle} deg, ${time} s`);
            }
        }
        const moved = [0, 45, 180, 290].some(angle => ribbonRadius(angle, { time: 7.3 + 1 / SILENCE_FPS }) !== ribbonRadius(angle, { time: 7.3 }));
        assert.ok(moved, "the wave moved");
    });
});

describe("the music the Lock Ring shows while it draws slowly", () => {
    test("it is the music at rest: no bands, no Kicks, the wave's phase held where it was", () => {
        assert.deepEqual(restingMusic(32, 3), {
            values: new Array(32).fill(0), bass: 0, mid: 0, treble: 0, kick: 0, flow: 3,
            kickAges: [], kickPowers: [], kickSeeds: [],
        });
    });
});

// The QML side: LockAudio.qml runs the pace for every ring at once; checked on its source, as
// tests/lock-plugin.test.mjs checks the plugin's.
describe("LockAudio's pace", () => {
    const read = file => fs.readFileSync(path.join(import.meta.dirname, "..", "lock-ring", file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const audio = read("LockAudio.qml");

    test("steps every frame with something to hear, and on a SILENCE_FPS clock while it draws slowly", () => {
        assert.match(audio, /import "pace\.mjs" as Pace/);
        assert.match(audio, /readonly property bool slow: Pace\.drawsSlowly\(/);
        assert.match(audio, /FrameAnimation \{\s*running: root\.running && !root\.slow/);
        assert.match(audio, /Timer \{[^}]*interval: 1000 \/ Pace\.SILENCE_FPS/);
        assert.match(audio, /Timer \{[^}]*running: root\.running && root\.slow/);
    });

    test("stops the pipeline's frame clock while slow: any running frame clock redraws the rings every frame", () => {
        assert.match(audio, /AudioPipeline \{[^}]*clockRunning: !root\.slow/);
    });

    test("comes to rest by the pipeline's Silence case and the ring's own motion", () => {
        assert.match(audio, /\brested = Pace\.atRest\(\{[^}]*silence: pipeline\?\.silence/);
        assert.match(audio, /readonly property var resting: Pace\.restingMusic\(/);
        for (const output of ["values", "bass", "mid", "treble", "flow", "kick", "kickAges", "kickPowers", "kickSeeds"])
            assert.match(audio, new RegExp(`property \\w+ ${output}: root\\.slow \\? root\\.resting\\.${output} : `), output);
    });

    test("keeps the ring's clocks itself, so the idle wave breathes and the time is right whatever the pipeline's clock does", () => {
        assert.doesNotMatch(audio, /pipeline\?\.time/);
        assert.match(audio, /property real time: 0/);
        assert.match(audio, /property var now: new Date\(\)/);
    });

    test("every ring takes the time from it, so the rings on every monitor stay in sync", () => {
        const ring = read("LockRing.qml");
        assert.doesNotMatch(ring, /FrameAnimation|Timer \{/);
        assert.match(ring, /property var now: LockAudio\.now/);
    });

    test("the Lyric Words step with it: every frame, or on its slow clock", () => {
        assert.match(read("LockLyrics.qml"), /FrameAnimation \{\s*running: !root\.slow/);
        assert.match(audio, /lyrics\.item\.syncWords\(\)/);
    });
});

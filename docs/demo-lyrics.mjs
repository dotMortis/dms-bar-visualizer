// The live demo's Lyric Words, apart from drawing: a short set of timed lines written for the demo
// (no one's song), in DMS's lyrics format, looped against the demo's own clock through the shared
// Lyric Words module (lyric-words.mjs). Both demo views take their words from here: the Lock Ring
// view on Ribbons or Hands, the bar view on Ribbons only. Plain JS for tests/demo-lyrics.test.mjs;
// docs/index.html imports it.
import { createLyricWords } from "./lyric-words.mjs";

// The demo's song, timed to the procedural loop's 120 bpm (a count every 0.5 s), as DMS's synced
// lines ({ t, e, x, w?, background?, group? }, seconds from the start):
//   - a line with word timing, "rivers" sung in two syllables
//   - a line with line timing only, its words spread evenly, with a background vocal under it
//   - a gap of four and a half seconds: an instrumental break, nothing shown
//   - a line with word timing, "never" in two syllables, and one more with line timing only
export const DEMO_LINES = [
    {
        t: 1, e: 4, x: "Neon rivers light the night",
        w: [
            { t: 1, e: 1.5, x: "Neon " }, { t: 1.5, e: 1.75, x: "ri" }, { t: 1.75, e: 2, x: "vers " },
            { t: 2, e: 2.5, x: "light " }, { t: 2.5, e: 3, x: "the " }, { t: 3, e: 4, x: "night" },
        ],
    },
    { t: 5, e: 8.5, x: "Every heartbeat sets the sky alight", group: 2 },
    { t: 6.5, e: 8.5, x: "so bright", background: true, group: 2 },
    {
        t: 13, e: 16.5, x: "Ride the wave, we never fall",
        w: [
            { t: 13, e: 13.5, x: "Ride " }, { t: 13.5, e: 14, x: "the " }, { t: 14, e: 14.5, x: "wave, " },
            { t: 14.5, e: 15, x: "we " }, { t: 15, e: 15.25, x: "nev" }, { t: 15.25, e: 15.5, x: "er " },
            { t: 15.5, e: 16.5, x: "fall" },
        ],
    },
    { t: 17, e: 20.5, x: "Dancing on the edge of sound" },
];

// The song's length, seconds: it starts again from the top after this.
export const DEMO_LOOP = 24;

// The demo song as the core takes it (core/src/lyric_words.rs, the bar view's Lyric Words): DMS's
// lyrics.get reply, as JSON text, and every letter of it, once each, for the page to measure.
export const DEMO_LYRICS = JSON.stringify({ found: true, synced: DEMO_LINES });
export const DEMO_LETTERS = [...new Set(DEMO_LINES.flatMap(line => Array.from(line.x.replace(/\s/g, ""))))].join("");

// Position readings for the core, the demo song looping from page time `start` (seconds): a
// function of the page time now (seconds) giving the song's position to read, once a second and
// at each loop's start (where it seeks back to the top), else null. As lyrics/BarLyrics.qml reads
// the Active Player's position.
export function createDemoReadings(start) {
    let last = -Infinity, loop = null;
    return now => {
        const elapsed = Math.max(0, now - start);
        const n = Math.floor(elapsed / DEMO_LOOP);
        if (n === loop && now - last < 1)
            return null;
        loop = n;
        last = now;
        return elapsed - n * DEMO_LOOP;
    };
}

// The demo's Lyric Words, the demo song looping from wall-clock time `start` (ms, the page clock):
//   kick(power, wall)   a Kick the demo's Kick detector found at `wall` (ms)
//   words(wall)         the Lyric Words visible at `wall` (lyric-words.mjs words())
// `options`: { start, placement ("ribbons" for the bar, "ribbons-or-hands" for the Lock Ring),
// seed }. Each loop starts as a seek to the top, which clears the words.
export function createDemoLyrics({ start = 0, placement = "ribbons", seed = 1 } = {}) {
    const tracker = createLyricWords({ placement, seed });
    tracker.setTrack("demo", DEMO_LOOP);
    tracker.setLyrics({ found: true, synced: DEMO_LINES });
    let loop = null;
    // A reading at each loop's start: the song plays on at rate 1 in between.
    const sync = wall => {
        const elapsed = Math.max(0, (wall - start) / 1000);
        const n = Math.floor(elapsed / DEMO_LOOP);
        if (n === loop)
            return;
        loop = n;
        tracker.read({ position: elapsed - n * DEMO_LOOP, wall, rate: 1, playing: true });
    };
    return {
        kick(power, wall) {
            sync(wall);
            tracker.kick(power, wall);
        },
        words(wall) {
            sync(wall);
            return tracker.words(wall);
        },
    };
}

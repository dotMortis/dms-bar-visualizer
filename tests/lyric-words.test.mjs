// Lyric Words: the words of the Lyric Line, each showing from the moment it is sung until the
// line's end, then dissolving together. Driven only the way the visualizers drive the module: DMS's
// lyrics, a track and playback position readings; checked only by the words it says are visible.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LINGER, createLyricWords } from "../docs/lyric-words.mjs";

// Wall-clock times are in milliseconds, as Date.now() gives them.
const WALL = 1_000_000;

// A Lyric Words module playing `synced` lines (DMS's format) from song time `from`, at rate 1,
// placing words in `placement` mode (the bar's by default).
function playing(synced, { from = 0, length = 300, placement } = {}) {
    const lyrics = createLyricWords({ placement });
    lyrics.setTrack("track-1", length);
    lyrics.setLyrics({ state: "ready", synced });
    lyrics.read({ position: from, wall: WALL, rate: 1, playing: true });
    return lyrics;
}

// The wall-clock time at song time `t`, for a module started by playing() from song time `from`.
const wallAt = (t, from = 0) => WALL + (t - from) * 1000;
// The visible words' texts at song time `t`.
const textsAt = (lyrics, t, from = 0) => lyrics.words(wallAt(t, from)).map(w => w.text);
// The texts of the visible words that have started dissolving at song time `t`.
const dissolvingAt = (lyrics, t, from = 0) => lyrics.words(wallAt(t, from)).filter(w => w.dissolve > 0).map(w => w.text);

const piece = (t, e, x) => ({ t, e, x });

describe("a word appears as it is sung", () => {
    const line = { t: 10, e: 14, x: "hold the line", w: [piece(10, 10.5, "hold "), piece(11, 11.5, "the "), piece(12, 13, "line")] };

    test("not before its start, and from its start on", () => {
        const lyrics = playing([line]);
        assert.deepEqual(textsAt(lyrics, 9.99), []);
        assert.deepEqual(textsAt(lyrics, 10), ["hold"]);
        assert.deepEqual(textsAt(lyrics, 10.99), ["hold"]);
        assert.deepEqual(textsAt(lyrics, 11), ["hold", "the"]);
        assert.deepEqual(textsAt(lyrics, 12.5), ["hold", "the", "line"]);
    });
});

describe("syllables", () => {
    test("join into one word that starts with its first syllable", () => {
        const line = {
            t: 5, e: 9, x: "won-der-ful day",
            w: [piece(5, 5.3, "won-"), piece(5.4, 5.7, "der-"), piece(5.8, 6.2, "ful "), piece(7, 8, "day")],
        };
        const lyrics = playing([line]);
        assert.deepEqual(textsAt(lyrics, 4.99), []);
        assert.deepEqual(textsAt(lyrics, 5), ["won-der-ful"]);
        assert.deepEqual(textsAt(lyrics, 6.5), ["won-der-ful"]);
        assert.deepEqual(textsAt(lyrics, 7), ["won-der-ful", "day"]);
    });
});

describe("a line without word timing", () => {
    test("spreads its words evenly between its start and end", () => {
        const lyrics = playing([{ t: 20, e: 24, x: "one two three four" }]);
        assert.deepEqual(textsAt(lyrics, 20), ["one"]);
        assert.deepEqual(textsAt(lyrics, 20.99), ["one"]);
        assert.deepEqual(textsAt(lyrics, 21), ["one", "two"]);
        assert.deepEqual(textsAt(lyrics, 22), ["one", "two", "three"]);
        assert.deepEqual(textsAt(lyrics, 23), ["one", "two", "three", "four"]);
    });

    test("so does a line whose word timing doesn't join to its text", () => {
        const lyrics = playing([{ t: 20, e: 24, x: "one two three four", w: [piece(20, 20.5, "one "), piece(20.5, 21, "two")] }]);
        assert.deepEqual(textsAt(lyrics, 21), ["one", "two"]);
        assert.deepEqual(textsAt(lyrics, 22.5), ["one", "two", "three"]);
    });

    test("so does a line with a word piece starting before the line", () => {
        const lyrics = playing([{ t: 20, e: 24, x: "one two three four",
            w: [piece(19.5, 20, "one "), piece(20.2, 20.4, "two "), piece(20.4, 20.6, "three "), piece(20.6, 20.8, "four")] }]);
        assert.deepEqual(textsAt(lyrics, 20.9), ["one"]);
        assert.deepEqual(textsAt(lyrics, 23), ["one", "two", "three", "four"]);
    });
});

// The Lock Ring's placement in playing(): there a line's words start dissolving right at its end
// and are gone by the next one's, so the tests of when a line ends watch them there.
const RING = { placement: "ribbons-or-hands" };

describe("a line without an end time", () => {
    test("ends at its last word's end", () => {
        const lyrics = playing([
            { t: 10, x: "a b", w: [piece(10, 10.5, "a "), piece(11, 12, "b")] },
            { t: 30, e: 32, x: "next" },
        ], RING);
        assert.deepEqual(dissolvingAt(lyrics, 11.99), []);
        assert.deepEqual(dissolvingAt(lyrics, 12.1), ["a", "b"]);
    });

    test("else at the next line's start", () => {
        const lyrics = playing([{ t: 10, x: "a b" }, { t: 14, e: 16, x: "next" }], RING);
        assert.deepEqual(textsAt(lyrics, 11.99), ["a"]);
        assert.deepEqual(textsAt(lyrics, 12), ["a", "b"]);
        assert.deepEqual(textsAt(lyrics, 13.99), ["a", "b"]);
        assert.deepEqual(dissolvingAt(lyrics, 13.99), []);
        assert.deepEqual(textsAt(lyrics, 14), ["next"]);
    });

    test("else at the track's end", () => {
        const lyrics = playing([{ t: 10, x: "a b" }], { length: 20, ...RING });
        assert.deepEqual(textsAt(lyrics, 14.99), ["a"]);
        assert.deepEqual(textsAt(lyrics, 15), ["a", "b"]);
        assert.deepEqual(dissolvingAt(lyrics, 19.99), []);
        assert.deepEqual(dissolvingAt(lyrics, 20.1), ["a", "b"]);
    });
});

describe("the end of a Lyric Line on the Lock Ring", () => {
    const verse = [
        { t: 10, e: 13, x: "first line here", w: [piece(10, 10.5, "first "), piece(11, 11.5, "line "), piece(12, 12.5, "here")] },
        { t: 20, e: 22, x: "second line" },
    ];

    test("all its words dissolve together, and are gone soon after", () => {
        const lyrics = playing(verse, RING);
        const before = lyrics.words(wallAt(12.9));
        assert.deepEqual(before.map(w => w.dissolve), [0, 0, 0]);
        const during = lyrics.words(wallAt(13.2));
        assert.equal(during.length, 3);
        assert.ok(during[0].dissolve > 0 && during[0].dissolve < 1, `dissolve ${during[0].dissolve}`);
        assert.ok(during.every(w => w.dissolve === during[0].dissolve), "together");
        assert.ok(lyrics.words(wallAt(13.5)).every(w => w.dissolve > during[0].dissolve), "and onward");
        assert.deepEqual(textsAt(lyrics, 14), []);
    });

    test("nothing shows between lines", () => {
        const lyrics = playing(verse, RING);
        for (const t of [14, 16, 19.99])
            assert.deepEqual(textsAt(lyrics, t), [], `at ${t}`);
        assert.deepEqual(textsAt(lyrics, 20), ["second"]);
    });

    test("no two lines are ever visible together", () => {
        const lyrics = playing([
            { t: 10, e: 16, x: "long line" },
            { t: 12, e: 14, x: "cut in" },
            { t: 14, e: 15, x: "back to back" },
        ], RING);
        for (let t = 9; t <= 17; t += 0.05) {
            const lines = new Set(lyrics.words(wallAt(t)).map(w => w.key.split(":")[0]));
            assert.ok(lines.size <= 1, `at ${t.toFixed(2)}: lines ${[...lines]}`);
        }
        assert.deepEqual(textsAt(lyrics, 11.99), ["long"]);
        assert.deepEqual(textsAt(lyrics, 12), ["cut"]);
        assert.deepEqual(textsAt(lyrics, 14), ["back"]);
    });

    test("a line whose next one comes soon dissolves in the time left before it", () => {
        // The first line ends at 13 and the next starts at 13.3: a 0.3 s dissolve, not the full one.
        const lyrics = playing([{ t: 10, e: 13, x: "first" }, { t: 13.3, e: 15, x: "second" }], RING);
        assert.equal(lyrics.words(wallAt(12.99))[0].dissolve, 0);
        const half = lyrics.words(wallAt(13.15));
        assert.deepEqual(half.map(w => w.text), ["first"]);
        assert.ok(Math.abs(half[0].dissolve - 0.5) < 1e-6, `dissolve ${half[0].dissolve}`);
        assert.ok(lyrics.words(wallAt(13.29))[0].dissolve > 0.9);
        assert.deepEqual(textsAt(lyrics, 13.3), ["second"]);
    });
});

describe("the end of a Lyric Line on the bar", () => {
    // "first" ends at 13; "second" starts at 13.3.
    const close = [{ t: 10, e: 13, x: "first" }, { t: 13.3, e: 15, x: "second" }];

    test("its rows stay whole LINGER.hold seconds, while the next line's words come", () => {
        assert.ok(LINGER.hold > 0.3, String(LINGER.hold));
        const lyrics = playing(close);
        const during = lyrics.words(wallAt(13 + LINGER.hold - 0.01));
        assert.deepEqual(during.map(w => [w.text, w.dissolve]), [["first", 0], ["second", 0]]);
    });

    test("then dissolve slowly, over LINGER.dissolve seconds, and are gone", () => {
        assert.ok(LINGER.dissolve > 1, String(LINGER.dissolve));
        const lyrics = playing(close);
        const fade = 13 + LINGER.hold;
        const half = lyrics.words(wallAt(fade + LINGER.dissolve / 2)).find(w => w.text === "first");
        assert.ok(Math.abs(half.dissolve - 0.5) < 1e-6, `dissolve ${half.dissolve}`);
        assert.deepEqual(textsAt(lyrics, fade + LINGER.dissolve + 0.01), ["second"]);
    });

});

describe("one Lyric Line, every part of it", () => {
    test("lead and background vocals and every singer show together, background smaller and dimmer", () => {
        const lyrics = playing([
            { t: 10, e: 14, x: "lead", voice: "v1", group: 1 },
            { t: 10, e: 14, x: "duet", voice: "v2", group: 1 },
            { t: 11, e: 13, x: "ooh", background: true, group: 1 },
            { t: 10.5, e: 14, x: "with", voice: "v1", group: 1 },
        ]);
        const words = lyrics.words(wallAt(12));
        assert.deepEqual(words.map(w => w.text).sort(), ["duet", "lead", "ooh", "with"]);
        const lead = words.find(w => w.text === "lead"), ooh = words.find(w => w.text === "ooh");
        assert.equal(lead.background, false);
        assert.equal(ooh.background, true);
        assert.ok(ooh.size < lead.size, `size ${ooh.size} vs ${lead.size}`);
        assert.ok(ooh.brightness < lead.brightness, `brightness ${ooh.brightness} vs ${lead.brightness}`);
    });

    test("lines starting together without a group are one Lyric Line", () => {
        const lyrics = playing([{ t: 10, e: 14, x: "lead" }, { t: 10, e: 12, x: "ooh", background: true }, { t: 11, e: 14, x: "later" }], RING);
        assert.deepEqual(textsAt(lyrics, 10.5), ["lead", "ooh"]);
        // A line starting later is the next Lyric Line, and takes over.
        assert.deepEqual(textsAt(lyrics, 11.5), ["later"]);
    });

    test("the lyrics controller's grouped lines read as DMS's synced lines", () => {
        const lyrics = createLyricWords();
        lyrics.setTrack("track-1", 300);
        lyrics.setLyrics({ state: "ready", synced: [{ t: 10, e: 14, parts: [{ t: 10, e: 14, x: "lead" }, { t: 10, e: 14, x: "ooh", background: true }] }] });
        lyrics.read({ position: 0, wall: WALL, rate: 1, playing: true });
        assert.deepEqual(lyrics.words(wallAt(12)).map(w => [w.text, w.background]), [["lead", false], ["ooh", true]]);
    });
});

describe("no synced lyrics, no words", () => {
    const synced = [{ t: 0, e: 100, x: "always singing" }];
    const cases = {
        "plain-text lyrics only": { found: true, synced: [], plain: "always singing" },
        "an instrumental": { found: true, instrumental: true, synced },
        "no lyrics found": { found: false, synced },
        "loading": { state: "loading", synced },
        "an instrumental (controller)": { state: "instrumental", synced },
        "none": { state: "none", synced },
        "an error": { state: "error", synced },
        "nothing at all": null,
    };
    for (const [name, given] of Object.entries(cases)) {
        test(name, () => {
            const lyrics = createLyricWords();
            lyrics.setTrack("track-1", 300);
            lyrics.setLyrics(given);
            lyrics.read({ position: 50, wall: WALL, rate: 1, playing: true });
            assert.deepEqual(lyrics.words(WALL + 1000), []);
        });
    }

    test("while a reply's synced lyrics do show", () => {
        const lyrics = createLyricWords();
        lyrics.setTrack("track-1", 300);
        lyrics.setLyrics({ found: true, synced, plain: "always singing" });
        lyrics.read({ position: 50, wall: WALL, rate: 1, playing: true });
        assert.deepEqual(lyrics.words(WALL + 1000).map(w => w.text), ["always", "singing"]);
    });
});

describe("the playback position", () => {
    test("runs on from the last reading at the playback rate", () => {
        const lyrics = createLyricWords();
        lyrics.read({ position: 30, wall: WALL, rate: 1, playing: true });
        assert.equal(lyrics.position(WALL + 2500), 32.5);
        lyrics.read({ position: 32.5, wall: WALL + 2500, rate: 2, playing: true });
        assert.equal(lyrics.position(WALL + 3500), 34.5);
        lyrics.read({ position: 34.5, wall: WALL + 3500, rate: 0.5, playing: true });
        assert.equal(lyrics.position(WALL + 5500), 35.5);
    });

    test("follows each new reading", () => {
        const lyrics = createLyricWords();
        lyrics.read({ position: 30, wall: WALL, rate: 1, playing: true });
        lyrics.read({ position: 31.1, wall: WALL + 1000, rate: 1, playing: true });
        assert.equal(lyrics.position(WALL + 2000), 32.1);
    });

    test("stands still while paused", () => {
        const lyrics = createLyricWords();
        lyrics.read({ position: 30, wall: WALL, rate: 1, playing: false });
        assert.equal(lyrics.position(WALL + 60000), 30);
    });

    test("words follow the playback rate", () => {
        const lyrics = createLyricWords();
        lyrics.setTrack("track-1", 300);
        lyrics.setLyrics({ state: "ready", synced: [{ t: 10, e: 14, x: "one two three four" }] });
        lyrics.read({ position: 10, wall: WALL, rate: 2, playing: true });
        assert.deepEqual(lyrics.words(WALL + 600).map(w => w.text), ["one", "two"]);
    });
});

describe("on pause", () => {
    test("the words freeze: none come, none go, none dissolve", () => {
        const lyrics = playing([{ t: 10, e: 13, x: "a b c" }]);
        const pausedAt = wallAt(12.9);
        lyrics.read({ position: 12.9, wall: pausedAt, rate: 1, playing: false });
        const frozen = lyrics.words(pausedAt);
        assert.deepEqual(frozen.map(w => w.text), ["a", "b", "c"]);
        for (const later of [1000, 10000, 600000])
            assert.deepEqual(lyrics.words(pausedAt + later), frozen, `${later} ms later`);
    });

    test("and carry on when playback resumes", () => {
        const lyrics = playing([{ t: 10, e: 13, x: "a b c" }]);
        const pausedAt = wallAt(10.5);
        lyrics.read({ position: 10.5, wall: pausedAt, rate: 1, playing: false });
        lyrics.read({ position: 10.5, wall: pausedAt + 30000, rate: 1, playing: true });
        assert.deepEqual(lyrics.words(pausedAt + 30000 + 600).map(w => w.text), ["a", "b"]);
    });
});

describe("a seek", () => {
    const verse = [
        { t: 10, e: 14, x: "first one two three" },
        { t: 30, e: 34, x: "second one two three" },
    ];

    test("clears the words", () => {
        const lyrics = playing(verse);
        assert.deepEqual(textsAt(lyrics, 13), ["first", "one", "two", "three"]);
        lyrics.read({ position: 20, wall: wallAt(13), rate: 1, playing: true });
        assert.deepEqual(lyrics.words(wallAt(13)), []);
    });

    test("brings back the current line's sung words at once, without pop-ins", () => {
        const lyrics = playing(verse);
        textsAt(lyrics, 13);
        lyrics.read({ position: 32.5, wall: wallAt(13), rate: 1, playing: true });
        const back = lyrics.words(wallAt(13));
        assert.deepEqual(back.map(w => w.text), ["second", "one", "two"]);
        assert.ok(back.every(w => w.popIn === 1), back.map(w => w.popIn).join());
        // The next word pops in as usual.
        const next = lyrics.words(wallAt(13.5 + 0.05)).find(w => w.text === "three");
        assert.ok(next && next.popIn > 0 && next.popIn < 1, `popIn ${next && next.popIn}`);
    });

    test("does not bring back a line that was already dissolving", () => {
        const lyrics = playing(verse);
        lyrics.read({ position: 14.2, wall: wallAt(1), rate: 1, playing: true });
        assert.deepEqual(lyrics.words(wallAt(1)), []);
    });

    test("backwards clears too", () => {
        const lyrics = playing(verse);
        textsAt(lyrics, 33);
        lyrics.read({ position: 11.5, wall: wallAt(33), rate: 1, playing: true });
        const back = lyrics.words(wallAt(33));
        assert.deepEqual(back.map(w => w.text), ["first", "one"]);
        assert.ok(back.every(w => w.popIn === 1));
    });

    test("small drifts in the readings are no seek: words keep popping in", () => {
        const lyrics = playing(verse);
        textsAt(lyrics, 9.9);
        lyrics.read({ position: 10.95, wall: wallAt(11), rate: 1, playing: true });
        const word = lyrics.words(wallAt(11.05)).find(w => w.text === "one");
        assert.ok(word && word.popIn < 1, `popIn ${word && word.popIn}`);
    });
});

describe("a track change", () => {
    test("clears the words, until the new track's lyrics come", () => {
        const lyrics = playing([{ t: 0, e: 100, x: "old song" }]);
        assert.deepEqual(textsAt(lyrics, 50), ["old", "song"]);
        lyrics.setTrack("track-2", 200);
        assert.deepEqual(textsAt(lyrics, 50), []);
        lyrics.setLyrics({ state: "ready", synced: [{ t: 0, e: 100, x: "new song" }] });
        assert.deepEqual(textsAt(lyrics, 50), ["new", "song"]);
    });

    test("the same track again keeps its lyrics", () => {
        const lyrics = playing([{ t: 0, e: 100, x: "old song" }]);
        lyrics.setTrack("track-1", 300);
        assert.deepEqual(textsAt(lyrics, 50), ["old", "song"]);
    });
});

describe("pop-in", () => {
    test("runs from the word's start", () => {
        const lyrics = playing([{ t: 10, e: 14, x: "solo" }]);
        textsAt(lyrics, 9);
        const popIn = t => lyrics.words(wallAt(t))[0].popIn;
        assert.equal(popIn(10), 0);
        assert.ok(popIn(10.1) > 0 && popIn(10.1) < 1);
        assert.equal(popIn(11), 1);
    });

    test("lyrics arriving mid-line bring its sung words without pop-ins", () => {
        const lyrics = createLyricWords();
        lyrics.setTrack("track-1", 300);
        lyrics.read({ position: 11, wall: WALL, rate: 1, playing: true });
        lyrics.words(WALL);
        lyrics.setLyrics({ state: "ready", synced: [{ t: 10, e: 14, x: "one two three four" }] });
        assert.deepEqual(lyrics.words(WALL + 100).map(w => [w.text, w.popIn]), [["one", 1], ["two", 1]]);
    });
});

// A line of `count` words, one a second from song time `t`, held until a second after its last.
function lineOf(count, t = 10) {
    const texts = Array.from({ length: count }, (_, i) => "w" + i);
    return { t, e: t + count + 1, x: texts.join(" "), w: texts.map((x, i) => piece(t + i, t + i + 0.5, i + 1 < count ? x + " " : x)) };
}

// A Lyric Words module like playing()'s, placing words in `placement` mode with `seed`.
function placing(synced, { placement, seed } = {}) {
    const lyrics = createLyricWords({ placement, seed });
    lyrics.setTrack("track-1", 300);
    lyrics.setLyrics({ state: "ready", synced });
    lyrics.read({ position: 0, wall: WALL, rate: 1, playing: true });
    return lyrics;
}

// The spots of the words visible at song time `t`.
const spotsAt = (lyrics, t) => lyrics.words(wallAt(t)).map(w => w.spot);

describe("placement on the Bar Visualizer: Ribbons only", () => {
    test("every word lands on one of the three Ribbons, somewhere across the bar", () => {
        for (let seed = 1; seed <= 20; seed++) {
            const spots = spotsAt(placing([lineOf(12)], { placement: "ribbons", seed }), 22.5);
            assert.equal(spots.length, 12);
            for (const spot of spots) {
                assert.equal(spot.on, "ribbon", JSON.stringify(spot));
                assert.ok([0, 1, 2].includes(spot.ribbon), JSON.stringify(spot));
                assert.ok(spot.x >= 0 && spot.x <= 1, JSON.stringify(spot));
            }
        }
    });

    test("is the default", () => {
        const spots = spotsAt(placing([lineOf(5)]), 15);
        assert.ok(spots.every(s => s.on === "ribbon" && s.x >= 0 && s.x <= 1), JSON.stringify(spots));
    });

    test("a row's later words follow its first: on its Ribbon, at its spot, after the words before them", () => {
        for (let seed = 1; seed <= 20; seed++) {
            const spots = spotsAt(placing([lineOf(4)], { seed }), 13.5);
            const [first] = spots;
            assert.deepEqual(spots.map(s => [s.ribbon, s.x, s.row]), Array(4).fill([first.ribbon, first.x, "w0 w1 w2 w3"]), `seed ${seed}`);
            assert.deepEqual(spots.map(s => s.before), ["", "w0 ", "w0 w1 ", "w0 w1 w2 "]);
        }
    });

    test("each line of a Lyric Line is its own row", () => {
        const lyrics = placing([
            { t: 10, e: 14, x: "lead line", group: 1 },
            { t: 10.5, e: 14, x: "ooh", background: true, group: 1 },
        ]);
        const spots = lyrics.words(wallAt(13)).map(w => [w.text, w.spot.row, w.spot.before]);
        assert.deepEqual(spots.sort(), [["line", "lead line", "lead "], ["lead", "lead line", ""], ["ooh", "ooh", ""]].sort());
    });

    test("a new row lands away from the rows already shown", () => {
        // Twelve random spots across the bar all within 0.2 of the first row: about 1 in 60000.
        for (let seed = 1; seed <= 100; seed++) {
            const [first, second] = spotsAt(placing([
                { t: 10, e: 14, x: "lead", group: 1 },
                { t: 10.5, e: 14, x: "ooh", background: true, group: 1 },
            ], { seed }), 11);
            assert.ok(Math.abs(first.x - second.x) >= 0.2, `seed ${seed}: ${first.x} ${second.x}`);
        }
    });

    test("there is no limit: with no free space left, words overlap", () => {
        const spots = spotsAt(placing([lineOf(60)]), 69.5);
        assert.equal(spots.length, 60);
        assert.ok(spots.every(s => s.on === "ribbon" && s.x >= 0 && s.x <= 1));
    });

    test("a word keeps its spot while it is shown", () => {
        const lyrics = placing([lineOf(4)], { seed: 7 });
        const early = spotsAt(lyrics, 11.5);
        const later = spotsAt(lyrics, 14.5);
        assert.deepEqual(later.slice(0, 2), early);
    });
});

describe("placement on the Lock Ring: Ribbons or Hands", () => {
    const spots = [];
    for (let seed = 1; seed <= 20; seed++)
        spots.push(...spotsAt(placing([lineOf(8)], { placement: "ribbons-or-hands", seed }), 18));

    test("words land on Ribbons, around the ring", () => {
        const ribbons = spots.filter(s => s.on === "ribbon");
        assert.ok(ribbons.length > 0);
        for (const spot of ribbons) {
            assert.ok([0, 1, 2].includes(spot.ribbon), JSON.stringify(spot));
            assert.ok(spot.angle >= 0 && spot.angle < 360, JSON.stringify(spot));
        }
    });

    test("and on every Hand, along it", () => {
        const hands = spots.filter(s => s.on === "hand");
        assert.deepEqual([...new Set(hands.map(s => s.hand))].sort(), ["hour", "minute", "second"]);
        for (const spot of hands)
            assert.ok(spot.along >= 0 && spot.along <= 1, JSON.stringify(spot));
    });

    test("and nowhere else", () => {
        assert.ok(spots.every(s => s.on === "ribbon" || s.on === "hand"), JSON.stringify(spots));
    });

    test("a new word lands away from the words already shown", () => {
        for (let seed = 1; seed <= 100; seed++) {
            const [first, second] = spotsAt(placing([lineOf(2)], { placement: "ribbons-or-hands", seed }), 11);
            const sameRibbon = first.on === "ribbon" && second.on === "ribbon";
            const sameHand = first.on === "hand" && second.on === "hand" && first.hand === second.hand;
            if (sameRibbon) {
                const d = Math.abs(first.angle - second.angle) % 360;
                assert.ok(Math.min(d, 360 - d) >= 36, `seed ${seed}: ${first.angle} ${second.angle}`);
            }
            if (sameHand)
                assert.ok(Math.abs(first.along - second.along) >= 0.2, `seed ${seed}: ${first.along} ${second.along}`);
        }
    });
});

describe("placement after the words clear", () => {
    test("the words that are gone don't keep new ones away", () => {
        // Two one-word lines, the second long after the first has gone: across seeds, the second
        // word sometimes lands right where the first was.
        const close = [];
        for (let seed = 1; seed <= 100; seed++) {
            const lyrics = placing([{ t: 10, e: 11, x: "gone" }, { t: 20, e: 21, x: "new" }], { seed });
            const [gone] = spotsAt(lyrics, 10.5);
            assert.deepEqual(spotsAt(lyrics, 15), []);
            const [fresh] = spotsAt(lyrics, 20.5);
            close.push(Math.abs(gone.x - fresh.x) < 0.1);
        }
        assert.ok(close.some(Boolean));
    });

    test("the same lyrics set again keep the words and their spots", () => {
        const synced = [lineOf(4)];
        for (let seed = 1; seed <= 20; seed++) {
            const lyrics = placing(synced, { seed });
            const before = lyrics.words(wallAt(12.5));
            // DMS's background refresh: equal lyrics, a fresh object.
            lyrics.setLyrics({ state: "ready", synced: JSON.parse(JSON.stringify(synced)) });
            const after = lyrics.words(wallAt(12.5));
            assert.deepEqual(after.map(w => [w.key, w.spot, w.popIn]), before.map(w => [w.key, w.spot, w.popIn]), `seed ${seed}`);
        }
    });

    test("a seek places the words it brings back afresh", () => {
        let moved = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const lyrics = placing([{ t: 10, e: 14, x: "here" }], { seed });
            const [before] = spotsAt(lyrics, 10.5);
            lyrics.read({ position: 10.5, wall: wallAt(30), rate: 1, playing: true });
            const [after] = lyrics.words(wallAt(30)).map(w => w.spot);
            if (after.x !== before.x)
                moved++;
        }
        assert.ok(moved > 0);
    });

    test("a new track's words don't take the old track's spots", () => {
        let moved = 0;
        for (let seed = 1; seed <= 20; seed++) {
            const lyrics = placing([{ t: 10, e: 14, x: "old" }], { seed });
            const [before] = spotsAt(lyrics, 10.5);
            lyrics.setTrack("track-2", 300);
            lyrics.setLyrics({ state: "ready", synced: [{ t: 10, e: 14, x: "new" }] });
            const [after] = spotsAt(lyrics, 10.6);
            if (after.x !== before.x)
                moved++;
        }
        assert.ok(moved > 0);
    });
});

describe("the pop", () => {
    // Two words, at song times 10 and 11.
    const two = () => playing([lineOf(2)]);
    const popOf = (lyrics, text, t) => lyrics.words(wallAt(t)).find(w => w.text === text).pop;

    test("every word pops", () => {
        const lyrics = two();
        assert.ok(popOf(lyrics, "w0", 10) > 0);
    });

    test("a word arriving with a Kick pops harder than one without", () => {
        const lyrics = two();
        lyrics.kick(1, wallAt(10));
        assert.ok(popOf(lyrics, "w0", 10.05) > popOf(lyrics, "w1", 11.05));
    });

    test("so does one whose Kick is detected just after it lands", () => {
        const lyrics = two();
        lyrics.words(wallAt(10));
        lyrics.kick(1, wallAt(10.05));
        assert.ok(popOf(lyrics, "w0", 10.1) > popOf(lyrics, "w1", 11.1));
    });

    test("a word keeps its pop while it is shown", () => {
        const lyrics = playing([lineOf(8)]);
        lyrics.kick(1, wallAt(10));
        const early = popOf(lyrics, "w0", 10.05);
        assert.equal(popOf(lyrics, "w0", 17.5), early);
    });

    test("a harder Kick pops harder", () => {
        const soft = two(), hard = two();
        soft.kick(0.5, wallAt(10));
        hard.kick(1, wallAt(10));
        assert.ok(popOf(hard, "w0", 10.05) > popOf(soft, "w0", 10.05));
    });

    test("a Kick well before or after a word doesn't make it pop harder", () => {
        const plain = popOf(two(), "w0", 10.05);
        const before = two();
        before.kick(1, wallAt(9.5));
        assert.equal(popOf(before, "w0", 10.05), plain);
        const after = two();
        after.kick(1, wallAt(10.6));
        assert.equal(popOf(after, "w0", 10.7), plain);
    });

    test("a Kick before a seek doesn't count after it", () => {
        const lyrics = two();
        lyrics.kick(1, wallAt(10));
        lyrics.read({ position: 0, wall: wallAt(10.01), rate: 1, playing: true });
        const plain = popOf(two(), "w0", 10.05);
        assert.equal(lyrics.words(wallAt(10.01) + 10050).find(w => w.text === "w0").pop, plain);
    });
});

describe("placement is seeded", () => {
    const run = seed => spotsAt(placing([lineOf(6)], { placement: "ribbons-or-hands", seed }), 16);

    test("the same seed gives the same placement", () => {
        assert.deepEqual(run(42), run(42));
    });

    test("another seed gives another", () => {
        assert.notDeepEqual(run(42), run(43));
    });
});

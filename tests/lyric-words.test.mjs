// Lyric Words: the words of the Lyric Line, each showing from the moment it is sung until the
// line's end, then dissolving together. Driven only the way the visualizers drive the module: DMS's
// lyrics, a track and playback position readings; checked only by the words it says are visible.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createLyricWords } from "../docs/lyric-words.mjs";

// Wall-clock times are in milliseconds, as Date.now() gives them.
const WALL = 1_000_000;

// A Lyric Words module playing `synced` lines (DMS's format) from song time `from`, at rate 1.
function playing(synced, { from = 0, length = 300 } = {}) {
    const lyrics = createLyricWords();
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

describe("a line without an end time", () => {
    test("ends at its last word's end", () => {
        const lyrics = playing([
            { t: 10, x: "a b", w: [piece(10, 10.5, "a "), piece(11, 12, "b")] },
            { t: 30, e: 32, x: "next" },
        ]);
        assert.deepEqual(dissolvingAt(lyrics, 11.99), []);
        assert.deepEqual(dissolvingAt(lyrics, 12.1), ["a", "b"]);
    });

    test("else at the next line's start", () => {
        const lyrics = playing([{ t: 10, x: "a b" }, { t: 14, e: 16, x: "next" }]);
        assert.deepEqual(textsAt(lyrics, 11.99), ["a"]);
        assert.deepEqual(textsAt(lyrics, 12), ["a", "b"]);
        assert.deepEqual(dissolvingAt(lyrics, 13.99), []);
        assert.deepEqual(dissolvingAt(lyrics, 14.1), ["a", "b"]);
    });

    test("else at the track's end", () => {
        const lyrics = playing([{ t: 10, x: "a b" }], { length: 20 });
        assert.deepEqual(textsAt(lyrics, 14.99), ["a"]);
        assert.deepEqual(textsAt(lyrics, 15), ["a", "b"]);
        assert.deepEqual(dissolvingAt(lyrics, 19.99), []);
        assert.deepEqual(dissolvingAt(lyrics, 20.1), ["a", "b"]);
    });
});

describe("the end of a Lyric Line", () => {
    const verse = [
        { t: 10, e: 13, x: "first line here", w: [piece(10, 10.5, "first "), piece(11, 11.5, "line "), piece(12, 12.5, "here")] },
        { t: 20, e: 22, x: "second line" },
    ];

    test("all its words dissolve together, and are gone soon after", () => {
        const lyrics = playing(verse);
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
        const lyrics = playing(verse);
        for (const t of [14, 16, 19.99])
            assert.deepEqual(textsAt(lyrics, t), [], `at ${t}`);
        assert.deepEqual(textsAt(lyrics, 20), ["second"]);
    });

    test("a line runs over into the next one only while it dissolves", () => {
        const lyrics = playing([{ t: 10, e: 16, x: "long line" }, { t: 12, e: 14, x: "cut in" }]);
        assert.deepEqual(dissolvingAt(lyrics, 11.9), []);
        assert.deepEqual(dissolvingAt(lyrics, 12.1), ["long"]);
        assert.deepEqual(textsAt(lyrics, 13.5), ["cut", "in"]);
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
        const lyrics = playing([{ t: 10, e: 14, x: "lead" }, { t: 10, e: 12, x: "ooh", background: true }, { t: 11, e: 14, x: "later" }]);
        assert.deepEqual(textsAt(lyrics, 10.5), ["lead", "ooh"]);
        assert.deepEqual(textsAt(lyrics, 11.5).sort(), ["later", "lead", "ooh"]);
        assert.deepEqual(dissolvingAt(lyrics, 11.5).sort(), ["lead", "ooh"]);
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

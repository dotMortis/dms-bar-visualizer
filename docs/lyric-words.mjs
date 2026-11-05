// Lyric Words, apart from drawing: which words of the Lyric Line are visible at any moment, and
// how far each one's pop-in and the line's dissolve have got. One stateful object per visualizer,
// in the style of the Lock Ring's hand and ring motion objects, fed with DMS's lyrics, the track
// and the Active Player's playback position readings. Plain JS for tests/lyric-words.test.mjs; the
// Bar Visualizer, the Lock Ring and the demo share it (it must pass Qt's JS engine, so no
// object spread).
//
// DMS's lyrics: lines are { t, e?, x, w?, voice?, background?, group? }, times in float seconds
// from the track start. Word pieces are w: [{ t, e, x }], a trailing space marking a word's end;
// a line without word timing has no w. The rules follow DMS's lyrics controller
// (Services/LyricsController.qml):
//   - Only synced lyrics give words: plain text, and the states loading, instrumental, none and
//     error, give none.
//   - Lines with the same group (or, without one, the same start) are one Lyric Line: lead and
//     background vocals, every singer. Background vocals are smaller and dimmer.
//   - Syllable pieces join into whole words; a word starts when its first piece starts. Word timing
//     is kept only if every piece starts at or after its line's start and the pieces join to the
//     line's text, else the line's words are spread evenly between its start and end, as for a
//     line without word timing.
//   - A line without an end time ends at its last word's end, else at the next Lyric Line's
//     start, else at the track's end.
//   - Only one Lyric Line at a time: a line ends at the next one's start at the latest. All its
//     words then dissolve together, over DISSOLVE seconds, or less when the next Lyric Line's
//     first word comes sooner; between lines nothing is shown.
//   - The position is extrapolated from the last reading, its wall-clock time and the playback
//     rate; paused, it stands still, and so do the words. A reading more than SEEK_TOLERANCE away
//     from the extrapolated position is a seek: it clears the words, as a track change does. The
//     Lyric Line's words already sung by then come back at once, without a pop-in.
//   - Each word lands at a random spot, seeded: on a Ribbon (the bar), or on a Ribbon or a Hand
//     (the Lock Ring). Of several random spots it takes the one furthest from the words shown, so
//     words overlap only when no space is left; there is no limit on their number. Turning a spot
//     into pixels is each visualizer's job.
//   - Each word pops in, harder when a Kick lands with it.

// Seconds a word takes to pop in, from its start.
export const POP_IN = 0.25;
// Seconds the words of a Lyric Line take to dissolve, from its end (less when the next line's
// first word comes sooner).
export const DISSOLVE = 0.6;
// How far (seconds) a reading may stray from the extrapolated position before it counts as a seek.
// MPRIS positions jitter by a few tens of milliseconds; a seek moves much farther.
export const SEEK_TOLERANCE = 1;
// Background vocals: their size and brightness, as a share of the lead's.
export const BACKGROUND = { size: 0.7, brightness: 0.55 };
// A word's pop: `base` for every word, `kick` more times the power (0.5..1, docs/kick.mjs) of a
// Kick landing with it, within `window` seconds of its start either way.
export const POP = { base: 0.4, kick: 0.6, window: 0.15 };
// The pace (seconds per word) a line's words are spread at when it has no end at all.
export const WORD_PACE = 0.4;

// The Ribbons a word can land on: three strands, on the bar (docs/bar-ribbons.mjs) as on the Lock
// Ring (lock-ring/ring.mjs).
export const RIBBONS = 3;

const LEAD = { size: 1, brightness: 1 };

// The Lock Ring's Hands a word can land on (lock-ring/hands.mjs HANDS).
export const HAND_NAMES = ["hour", "minute", "second"];
// How many random spots a new word tries; it takes the one furthest from the words shown.
export const TRIES = 12;

// A random spot for a word, in `placement` mode:
//   "ribbons"           { on: "ribbon", ribbon, x }      x: 0 (the bar's left edge) .. 1 (its right)
//   "ribbons-or-hands"  { on: "ribbon", ribbon, angle }  angle: clockwise degrees from 12 o'clock
//                       { on: "hand", hand, along }      along: 0 (the Hand's inner end) .. 1 (tip)
// ribbon is the strand, 0 .. RIBBONS - 1; hand one of HAND_NAMES. On the ring a word lands on a
// Ribbon or a Hand as likely.
function randomSpot(placement, random) {
    if (placement !== "ribbons-or-hands")
        return { on: "ribbon", ribbon: Math.floor(random() * RIBBONS), x: random() };
    if (random() < 0.5)
        return { on: "ribbon", ribbon: Math.floor(random() * RIBBONS), angle: random() * 360 };
    return { on: "hand", hand: HAND_NAMES[Math.floor(random() * HAND_NAMES.length)], along: random() };
}

// How far apart two spots are, 0 (on top of each other) .. 1. The strands of the Ribbons wave
// across each other, so only the way along them counts: across the bar, or around the ring. A Hand
// turns, so its words are only apart from each other along it, and from words elsewhere (the
// Ribbons, outside the dial, and the other Hands, which only meet it now and then) far apart.
function apart(a, b) {
    if (a.on === "ribbon" && b.on === "ribbon") {
        if (a.x !== undefined)
            return Math.abs(a.x - b.x);
        const d = Math.abs(a.angle - b.angle) % 360;
        return Math.min(d, 360 - d) / 180;
    }
    if (a.on === "hand" && b.on === "hand" && a.hand === b.hand)
        return Math.abs(a.along - b.along);
    return 1;
}

// A spot for a new word: of TRIES random ones, the one furthest from the spots `taken`.
function place(placement, random, taken) {
    let best = null, bestGap = -1;
    for (let i = 0; i < TRIES; i++) {
        const spot = randomSpot(placement, random);
        let gap = Infinity;
        for (const other of taken)
            gap = Math.min(gap, apart(spot, other));
        if (gap > bestGap) {
            best = spot;
            bestGap = gap;
        }
    }
    return best;
}

// A seeded random number generator, 0 <= x < 1 (mulberry32).
function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const isTime = t => typeof t === "number" && isFinite(t);
const clamp01 = x => Math.min(1, Math.max(0, x));

// DMS's synced lines (or its controller's grouped lines, each with `parts`) as plain lines.
function plainLines(lyrics) {
    if (!lyrics)
        return [];
    const ready = lyrics.state === undefined || lyrics.state === "ready";
    const synced = Array.isArray(lyrics) ? lyrics : lyrics.synced;
    if (!ready || lyrics.found === false || lyrics.instrumental === true || !Array.isArray(synced))
        return [];
    const lines = [];
    for (const line of synced) {
        for (const part of Array.isArray(line && line.parts) ? line.parts : [line]) {
            if (part && isTime(part.t) && part.t >= 0 && typeof part.x === "string")
                lines.push(part);
        }
    }
    return lines;
}

// A line's word pieces, if their timing can be trusted (DMS's wordsFor()); else null.
function trustedPieces(line) {
    const w = line.w;
    if (!Array.isArray(w) || w.length === 0)
        return null;
    if (!w.every(p => p && isTime(p.t) && p.t >= line.t && typeof p.x === "string"))
        return null;
    if (w.map(p => p.x).join("") !== line.x)
        return null;
    return w.map(p => ({ t: p.t, e: isTime(p.e) && p.e > p.t ? p.e : p.t, x: p.x }))
        .sort((a, b) => a.t - b.t);
}

// Pieces joined into whole words: [{ text, t }], each starting with its first piece. Whitespace
// ends a word, also inside a piece.
function joinPieces(pieces) {
    const words = [];
    let text = "", start = 0;
    const finish = () => {
        if (text !== "")
            words.push({ text, t: start });
        text = "";
    };
    for (const p of pieces) {
        for (const token of p.x.split(/(\s+)/)) {
            if (token === "")
                continue;
            if (/^\s+$/.test(token)) {
                finish();
                continue;
            }
            if (text === "")
                start = p.t;
            text += token;
        }
    }
    finish();
    return words;
}

// The Lyric Lines of `lyrics`, in order: [{ t, end, gone, words: [{ text, t, background }] }], for
// a track `length` seconds long (0 or less: unknown). At `gone` its dissolve is over.
function lyricLines(lyrics, length) {
    const groups = new Map();
    for (const line of plainLines(lyrics)) {
        const key = Number.isInteger(line.group) && line.group > 0 ? "group:" + line.group : "time:" + line.t;
        if (!groups.has(key))
            groups.set(key, { t: line.t, parts: [] });
        const group = groups.get(key);
        group.t = Math.min(group.t, line.t);
        group.parts.push(line);
    }
    const ordered = Array.from(groups.values()).sort((a, b) => a.t - b.t);
    const trackEnd = isTime(length) && length > 0 ? length : Infinity;
    const lines = ordered.map((group, i) => {
        const next = i + 1 < ordered.length ? ordered[i + 1].t : Infinity;
        let end = -Infinity;
        const words = [];
        for (const part of group.parts) {
            const pieces = trustedPieces(part);
            const partEnd = lineEnd(part, pieces, next, trackEnd);
            end = Math.max(end, partEnd);
            const background = part.background === true;
            const partWords = pieces ? joinPieces(pieces) : spread(part, partEnd);
            for (const word of partWords)
                words.push({ text: word.text, t: word.t, background });
        }
        words.sort((a, b) => a.t - b.t);
        return { t: group.t, end: Math.min(end, next), words };
    });
    // A line dissolves from its end for DISSOLVE seconds, or until the next Lyric Line's first word
    // if that comes sooner: only one Lyric Line is ever shown.
    lines.forEach((line, i) => {
        const following = lines[i + 1];
        const nextWord = !following ? Infinity : following.words.length > 0 ? following.words[0].t : following.t;
        line.gone = Math.min(line.end + DISSOLVE, Math.max(line.end, nextWord));
    });
    return lines;
}

// When a line ends: its own end time, else its last word's end, else the next Lyric Line's start,
// else the track's end. Never at or before its last word's start.
function lineEnd(line, pieces, next, trackEnd) {
    const last = pieces ? pieces[pieces.length - 1] : null;
    const fallback = next > line.t ? Math.min(next, trackEnd) : trackEnd;
    let end;
    if (isTime(line.e) && line.e > line.t)
        end = line.e;
    else if (last && last.e > last.t)
        end = Math.max.apply(null, pieces.map(p => p.e));
    else
        end = fallback;
    if (last && end <= last.t)
        end = next > last.t ? next : trackEnd;
    return end;
}

// A line's words spread evenly between its start and `end` (at WORD_PACE if it never ends).
function spread(line, end) {
    const texts = line.x.split(/\s+/).filter(x => x !== "");
    const span = isTime(end) ? end - line.t : texts.length * WORD_PACE;
    return texts.map((text, i) => ({ text, t: line.t + i * span / texts.length }));
}

// The Lyric Words of one visualizer. Feed it with
//   setTrack(id, length)   the Active Player's track: an identity (any string) and its length in
//                          seconds (0: unknown). A new identity drops the lyrics and clears the words.
//   setLyrics(lyrics)      DMS's lyrics for that track: its lyrics.get reply's result ({ found,
//                          synced, plain, instrumental }), or { state, synced } with the lyrics
//                          controller's state and lines; null for none. Lyrics giving the same
//                          Lyric Lines as before keep the words shown; others clear them.
//   read(reading)          a playback position reading: { position (seconds), wall (ms, as
//                          Date.now()), rate (1 = normal), playing (false = paused) }.
// and ask it
//   position(wall)         the song time (seconds) at wall-clock time `wall` (ms)
//   words(wall)            the Lyric Words visible at `wall`, in the order they were sung:
//                          [{ key, text, background, size, brightness, spot, popIn, pop, dissolve }]
//     key         stable while the word is shown: "<line>:<word>"
//     background  whether it is a background vocal
//     size        its size factor (1 = a lead vocal's)
//     brightness  its brightness factor (1 = a lead vocal's)
//     spot        where it landed (randomSpot()), kept while it is shown: the furthest from the
//                 words shown of TRIES random spots, so words overlap only when no space is left
//     popIn       how far its pop-in has got, 0..1 (1 at once for words restored after a seek)
//     pop         how hard it pops in, POP.base .. 1: harder with a Kick landing with it
//     dissolve    how far the line's dissolve has got, 0 (whole) .. 1 (gone)
// Also feed it
//   kick(power, wall)      a Kick the Kick detector found at `wall` (ms), with its power (0.5..1)
// `options` picks where words land and seeds it, for repeatable placement:
//   { placement: "ribbons" (the bar, the default) or "ribbons-or-hands" (the Lock Ring), seed }
export function createLyricWords(options) {
    const placement = options && options.placement === "ribbons-or-hands" ? "ribbons-or-hands" : "ribbons";
    const random = seeded(options && isTime(options.seed) ? options.seed : 1);
    let track = null, length = 0, lyrics = null, lines = [];
    let shownWords = new Map(); // key -> { spot, kick }: where each word shown landed, its Kick's power
    let kicks = [];             // the recent Kicks: [{ t (song time), power }]
    let anchor = null;      // the last reading: { position, wall, rate, playing }
    let cleared = 0;        // the song time of the last clear; words sung before it don't pop in
    let clearing = false;   // a clear (new track or lyrics) waiting for its song time: the next words() takes it

    const position = wall => {
        if (!anchor)
            return 0;
        if (!anchor.playing)
            return anchor.position;
        return anchor.position + (wall - anchor.wall) * anchor.rate / 1000;
    };
    const rebuild = () => {
        lines = lyricLines(lyrics, length);
    };

    return {
        setTrack(id, trackLength) {
            const changed = id !== track;
            track = id;
            length = trackLength;
            if (changed)
                lyrics = null;
            rebuild();
            if (changed)
                clearing = true;
        },

        // DMS refetches in the background: the same Lyric Lines again keep the words and their spots.
        setLyrics(next) {
            const before = JSON.stringify(lines);
            lyrics = next;
            rebuild();
            if (JSON.stringify(lines) !== before)
                clearing = true;
        },

        read(reading) {
            const wall = reading.wall;
            const at = isTime(reading.position) ? reading.position : 0;
            const seek = !anchor || Math.abs(at - position(wall)) > SEEK_TOLERANCE;
            anchor = {
                position: at,
                wall,
                rate: isTime(reading.rate) ? reading.rate : 1,
                playing: reading.playing !== false,
            };
            if (seek) {
                cleared = at;
                clearing = false;
                shownWords = new Map();
                kicks = [];
            }
        },

        kick(power, wall) {
            if (isTime(power) && power > 0)
                kicks.push({ t: position(wall), power: Math.min(1, power) });
        },

        position,

        words(wall) {
            const now = position(wall);
            if (clearing) {
                cleared = now;
                clearing = false;
                shownWords = new Map();
                kicks = [];
            }
            kicks = kicks.filter(k => k.t >= now - 1 && k.t <= now + POP.window);
            const kickAt = t => kicks.reduce((p, k) => Math.abs(k.t - t) <= POP.window ? Math.max(p, k.power) : p, 0);
            // Each word keeps its spot and its Kick while it is shown; words gone, by the line's end
            // or a clear, give up theirs, since keys come back.
            const kept = new Map();
            const shown = [], fresh = [];
            lines.forEach((line, l) => {
                if (now < line.t || now >= line.gone)
                    return;
                // A line that ended before the last clear stays cleared.
                if (line.end < cleared && now >= line.end)
                    return;
                const dissolve = now >= line.end ? clamp01((now - line.end) / (line.gone - line.end)) : 0;
                line.words.forEach((word, w) => {
                    if (word.t > now)
                        return;
                    const key = l + ":" + w;
                    const held = shownWords.get(key);
                    const kick = Math.max(held ? held.kick : 0, kickAt(word.t));
                    const look = word.background ? BACKGROUND : LEAD;
                    const entry = {
                        key,
                        text: word.text,
                        background: word.background,
                        size: look.size,
                        brightness: look.brightness,
                        spot: held ? held.spot : null,
                        popIn: word.t < cleared ? 1 : clamp01((now - word.t) / POP_IN),
                        pop: POP.base + POP.kick * kick,
                        dissolve,
                    };
                    shown.push(entry);
                    if (held)
                        kept.set(key, { spot: held.spot, kick });
                    else
                        fresh.push({ entry, kick });
                });
            });
            // A new word lands away from all the others shown.
            for (const { entry, kick } of fresh) {
                entry.spot = place(placement, random, Array.from(kept.values()).map(k => k.spot));
                kept.set(entry.key, { spot: entry.spot, kick });
            }
            shownWords = kept;
            return shown;
        },
    };
}

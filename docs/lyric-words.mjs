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
//     words then dissolve together, over DISSOLVE seconds; between lines nothing is shown.
//   - The position is extrapolated from the last reading, its wall-clock time and the playback
//     rate; paused, it stands still, and so do the words. A reading more than SEEK_TOLERANCE away
//     from the extrapolated position is a seek: it clears the words, as a track change does. The
//     Lyric Line's words already sung by then come back at once, without a pop-in.

// Seconds a word takes to pop in, from its start.
export const POP_IN = 0.25;
// Seconds the words of a Lyric Line take to dissolve, from its end.
export const DISSOLVE = 0.6;
// How far (seconds) a reading may stray from the extrapolated position before it counts as a seek.
// MPRIS positions jitter by a few tens of milliseconds; a seek moves much farther.
export const SEEK_TOLERANCE = 1;
// Background vocals: their size and brightness, as a share of the lead's.
export const BACKGROUND = { size: 0.7, brightness: 0.55 };
// The pace (seconds per word) a line's words are spread at when it has no end at all.
export const WORD_PACE = 0.4;

const LEAD = { size: 1, brightness: 1 };
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

// The Lyric Lines of `lyrics`, in order: [{ t, end, words: [{ text, t, background }] }], for a
// track `length` seconds long (0 or less: unknown).
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
    return ordered.map((group, i) => {
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
//                          controller's state and lines; null for none.
//   read(reading)          a playback position reading: { position (seconds), wall (ms, as
//                          Date.now()), rate (1 = normal), playing (false = paused) }.
// and ask it
//   position(wall)         the song time (seconds) at wall-clock time `wall` (ms)
//   words(wall)            the Lyric Words visible at `wall`, in the order they were sung:
//                          [{ key, text, background, size, brightness, popIn, dissolve }]
//     key         stable while the word is shown: "<line>:<word>"
//     background  whether it is a background vocal
//     size        its size factor (1 = a lead vocal's)
//     brightness  its brightness factor (1 = a lead vocal's)
//     popIn       how far its pop-in has got, 0..1 (1 at once for words restored after a seek)
//     dissolve    how far the line's dissolve has got, 0 (whole) .. 1 (gone)
export function createLyricWords() {
    let track = null, length = 0, lyrics = null, lines = [];
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

        setLyrics(next) {
            lyrics = next;
            rebuild();
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
            }
        },

        position,

        words(wall) {
            const now = position(wall);
            if (clearing) {
                cleared = now;
                clearing = false;
            }
            const shown = [];
            lines.forEach((line, l) => {
                if (now < line.t || now >= line.end + DISSOLVE)
                    return;
                // A line that ended before the last clear stays cleared.
                if (line.end < cleared && now >= line.end)
                    return;
                const dissolve = now >= line.end ? clamp01((now - line.end) / DISSOLVE) : 0;
                line.words.forEach((word, w) => {
                    if (word.t > now)
                        return;
                    const look = word.background ? BACKGROUND : LEAD;
                    shown.push({
                        key: l + ":" + w,
                        text: word.text,
                        background: word.background,
                        size: look.size,
                        brightness: look.brightness,
                        popIn: word.t < cleared ? 1 : clamp01((now - word.t) / POP_IN),
                        dissolve,
                    });
                });
            });
            return shown;
        },
    };
}

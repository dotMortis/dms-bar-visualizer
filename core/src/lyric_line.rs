//! The Lyric Line's timing, apart from drawing: which Lyric Words are visible at a song time, where
//! each one landed, and how far each one's pop-in and the line's dissolve have got. Ported from
//! docs/lyric-words.mjs (v0.10.0), which follows DMS's lyrics controller
//! (Services/LyricsController.qml):
//!   - Only synced lyrics give words: plain text, and the states loading, instrumental, none and
//!     error, give none.
//!   - Lines with the same group (or, without one, the same start) are one Lyric Line: lead and
//!     background vocals, every singer. Background vocals are smaller and dimmer.
//!   - Syllable pieces join into whole words; a word starts when its first piece starts. Word
//!     timing is kept only if every piece starts at or after its line's start and the pieces join
//!     to the line's text, else the line's words are spread evenly between its start and end.
//!   - A line without an end time ends at its last word's end, else at the next Lyric Line's
//!     start, else at the track's end; at the next one's start at the latest. On the bar its words
//!     then linger (LINGER_HOLD) and dissolve together (LINGER_DISSOLVE) while the next line's
//!     words come.
//!   - The position runs on from the last reading at the playback rate, on the core's own clock
//!     (display seconds); while the Active Player doesn't play, it stands still, and so do the
//!     words. A reading more than SEEK_TOLERANCE away from where it ran to is a seek: it clears
//!     the words, as a new track or new lyrics do. The Lyric Line's words already sung by then come
//!     back at once, without a pop-in.
//!   - Each word lands at a random spot, seeded (mulberry32, drawn in the order words appear): on
//!     the bar, on a Ribbon; of TRIES random spots it takes the one furthest from the words shown,
//!     so words overlap only when no space is left. The words of each of DMS's lines are one row:
//!     only the row's first word lands at a random spot, the rest follow it.
//!   - Each word pops in, harder when a Kick lands with it.
//!
//! setLyrics may allocate; the per-frame `step` doesn't: its buffers are sized for the most words
//! the lyrics can ever show at once.

use serde_json::Value;

/// Seconds a word takes to pop in, from its start.
pub const POP_IN: f64 = 0.25;
/// On the bar, where each row has its own place, a Lyric Line's words linger: they stay whole
/// LINGER_HOLD seconds past its end, then dissolve over LINGER_DISSOLVE seconds, while the next
/// line's words come.
pub const LINGER_HOLD: f64 = 1.0;
pub const LINGER_DISSOLVE: f64 = 1.5;
/// How far (seconds) a reading may stray from the position run on to before it counts as a seek.
/// MPRIS positions jitter by a few tens of milliseconds; a seek moves much farther.
pub const SEEK_TOLERANCE: f64 = 1.0;
/// Background vocals: their size and brightness, as a share of the lead's.
pub const BACKGROUND_SIZE: f64 = 0.7;
pub const BACKGROUND_BRIGHTNESS: f64 = 0.55;
/// A word's pop: POP_BASE for every word, POP_KICK more times the power (0.5..1) of a Kick landing
/// with it, within POP_WINDOW seconds of its start either way.
pub const POP_BASE: f64 = 0.4;
pub const POP_KICK: f64 = 0.6;
pub const POP_WINDOW: f64 = 0.15;
/// The pace (seconds per word) a line's words are spread at when it has no end at all.
pub const WORD_PACE: f64 = 0.4;
/// The Ribbons a word can land on.
pub const RIBBONS: usize = 3;
/// How many random spots a new word tries; it takes the one furthest from the words shown.
pub const TRIES: usize = 12;
/// The most recent Kicks kept for the pop: far more than land within POP_WINDOW of a word.
const KICKS: usize = 64;

/// One Lyric Word shown, as of the last display frame.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct LyricWord {
    /// Which Lyric Line (in the song's order) and which of its words (in the order they're sung):
    /// together stable while the word is shown.
    pub line: usize,
    pub word: usize,
    /// Whether it is a background vocal: smaller and dimmer.
    pub background: bool,
    /// Its size and brightness factors (1 = a lead vocal's).
    pub size: f64,
    pub brightness: f64,
    /// How far its pop-in has got, 0..1 (1 at once for words brought back by a seek).
    pub pop_in: f64,
    /// How hard it pops in, POP_BASE .. 1: harder with a Kick landing with it.
    pub pop: f64,
    /// How far the line's dissolve has got, 0 (whole) .. 1 (gone).
    pub dissolve: f64,
    /// Where it landed, kept while it is shown: which Ribbon (0..RIBBONS - 1), and where across the
    /// bar its row lies, 0 (flush with the left edge) .. 1 (flush with the right).
    pub ribbon: usize,
    pub x: f64,
}

/// Whitespace as JS's `\s` has it: what ends a word and splits a line into words.
pub fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// One of DMS's synced lines, as far as the Lyric Words use it.
#[derive(Clone, Debug, PartialEq)]
struct PlainLine {
    t: f64,
    e: Option<f64>,
    x: String,
    /// Its word pieces, if their timing can be trusted (DMS's wordsFor()), sorted by start.
    pieces: Option<Vec<Piece>>,
    background: bool,
    /// Its group, if it's an integer above 0.
    group: Option<f64>,
}

#[derive(Clone, Debug, PartialEq)]
struct Piece {
    t: f64,
    e: f64,
    x: String,
}

/// A word of a Lyric Line.
#[derive(Clone, Debug, PartialEq)]
struct Word {
    text: String,
    t: f64,
    background: bool,
    /// Which of the Lyric Line's rows (DMS's lines) it's in, that row's words, and its words
    /// before this one, each with a space after it.
    row: usize,
    row_text: String,
    before: String,
}

#[derive(Clone, Debug, PartialEq)]
struct Line {
    t: f64,
    end: f64,
    /// When its dissolve starts, and when it's over.
    fade: f64,
    gone: f64,
    words: Vec<Word>,
}

fn time(value: &Value) -> Option<f64> {
    value.as_f64().filter(|t| t.is_finite())
}

/// DMS's synced lines (or its controller's grouped lines, each with `parts`) as plain lines:
/// none unless the lyrics are synced and ready.
fn plain_lines(lyrics: &Value) -> Vec<PlainLine> {
    let synced = match lyrics {
        Value::Array(_) => lyrics,
        Value::Object(o) => {
            let ready = o.get("state").is_none_or(|s| s == "ready");
            if !ready
                || o.get("found") == Some(&Value::Bool(false))
                || o.get("instrumental") == Some(&Value::Bool(true))
            {
                return Vec::new();
            }
            match o.get("synced") {
                Some(synced) => synced,
                None => return Vec::new(),
            }
        }
        _ => return Vec::new(),
    };
    let Some(synced) = synced.as_array() else { return Vec::new() };
    let mut lines = Vec::new();
    for line in synced {
        let parts = match line.get("parts").and_then(Value::as_array) {
            Some(parts) => parts.as_slice(),
            None => std::slice::from_ref(line),
        };
        for part in parts {
            let (Some(t), Some(x)) = (part.get("t").and_then(time), part.get("x").and_then(Value::as_str)) else {
                continue;
            };
            if t < 0.0 {
                continue;
            }
            let group = part.get("group").and_then(Value::as_f64).filter(|g| *g > 0.0 && g.fract() == 0.0);
            lines.push(PlainLine {
                t,
                e: part.get("e").and_then(time),
                x: x.to_owned(),
                pieces: trusted_pieces(part, t, x),
                background: part.get("background") == Some(&Value::Bool(true)),
                group,
            });
        }
    }
    lines
}

/// A line's word pieces, if their timing can be trusted: every piece starts at or after the line,
/// and they join to its text.
fn trusted_pieces(line: &Value, t: f64, x: &str) -> Option<Vec<Piece>> {
    let w = line.get("w")?.as_array()?;
    if w.is_empty() {
        return None;
    }
    let mut pieces = Vec::with_capacity(w.len());
    for p in w {
        let start = p.get("t").and_then(time).filter(|&s| s >= t)?;
        let text = p.get("x")?.as_str()?;
        let e = p.get("e").and_then(time).filter(|&e| e > start).unwrap_or(start);
        pieces.push(Piece { t: start, e, x: text.to_owned() });
    }
    if pieces.iter().map(|p| p.x.as_str()).collect::<String>() != x {
        return None;
    }
    pieces.sort_by(|a, b| a.t.total_cmp(&b.t));
    Some(pieces)
}

/// Pieces joined into whole words, (text, start), each starting with its first piece. Whitespace
/// ends a word, also inside a piece.
fn join_pieces(pieces: &[Piece]) -> Vec<(String, f64)> {
    let mut words = Vec::new();
    let (mut text, mut start) = (String::new(), 0.0);
    for p in pieces {
        for c in p.x.chars() {
            if is_space(c) {
                if !text.is_empty() {
                    words.push((std::mem::take(&mut text), start));
                }
                continue;
            }
            if text.is_empty() {
                start = p.t;
            }
            text.push(c);
        }
    }
    if !text.is_empty() {
        words.push((text, start));
    }
    words
}

/// A line's words spread evenly between its start and `end` (at WORD_PACE if it never ends).
fn spread(line: &PlainLine, end: f64) -> Vec<(String, f64)> {
    let texts: Vec<&str> = line.x.split(is_space).filter(|x| !x.is_empty()).collect();
    let n = texts.len() as f64;
    let span = if end.is_finite() { end - line.t } else { n * WORD_PACE };
    texts.iter().enumerate().map(|(i, text)| (text.to_string(), line.t + i as f64 * span / n)).collect()
}

/// When a line ends: its own end time, else its last word's end, else the next Lyric Line's start,
/// else the track's end. Never at or before its last word's start.
fn line_end(line: &PlainLine, next: f64, track_end: f64) -> f64 {
    let last = line.pieces.as_ref().and_then(|p| p.last());
    let mut end = match (line.e, last) {
        (Some(e), _) if e > line.t => e,
        (_, Some(last)) if last.e > last.t => {
            line.pieces.iter().flatten().map(|p| p.e).fold(f64::NEG_INFINITY, f64::max)
        }
        _ if next > line.t => next.min(track_end),
        _ => track_end,
    };
    if let Some(last) = last {
        if end <= last.t {
            end = if next > last.t { next } else { track_end };
        }
    }
    end
}

/// The Lyric Lines of `plain`, in order, for a track `length` seconds long (0 or less: unknown),
/// lingering as on the bar.
fn lyric_lines(plain: &[PlainLine], length: f64) -> Vec<Line> {
    #[derive(PartialEq)]
    enum Key {
        Group(f64),
        Time(f64),
    }
    let mut groups: Vec<(Key, f64, Vec<&PlainLine>)> = Vec::new();
    for line in plain {
        // -0 and 0 are one start, as JS's "time:0" keys have it.
        let key = line.group.map_or(Key::Time(line.t + 0.0), Key::Group);
        match groups.iter_mut().find(|g| g.0 == key) {
            Some(group) => {
                group.1 = group.1.min(line.t);
                group.2.push(line);
            }
            None => groups.push((key, line.t, vec![line])),
        }
    }
    groups.sort_by(|a, b| a.1.total_cmp(&b.1));
    let track_end = if length.is_finite() && length > 0.0 { length } else { f64::INFINITY };
    let mut lines = Vec::with_capacity(groups.len());
    for (i, (_, t, parts)) in groups.iter().enumerate() {
        let next = groups.get(i + 1).map_or(f64::INFINITY, |g| g.1);
        let mut end = f64::NEG_INFINITY;
        let mut words = Vec::new();
        for (row, part) in parts.iter().enumerate() {
            let part_end = line_end(part, next, track_end);
            end = end.max(part_end);
            let part_words = match &part.pieces {
                Some(pieces) => join_pieces(pieces),
                None => spread(part, part_end),
            };
            let row_text = part_words.iter().map(|w| w.0.as_str()).collect::<Vec<_>>().join(" ");
            let mut before = String::new();
            for (text, t) in part_words {
                words.push(Word {
                    t,
                    background: part.background,
                    row,
                    row_text: row_text.clone(),
                    before: before.clone(),
                    text: text.clone(),
                });
                before.push_str(&text);
                before.push(' ');
            }
        }
        words.sort_by(|a, b| a.t.total_cmp(&b.t));
        let end = end.min(next);
        let fade = end + LINGER_HOLD;
        lines.push(Line { t: *t, end, fade, gone: fade + LINGER_DISSOLVE, words });
    }
    lines
}

/// The most words, and the most letters of them, `lines` can ever show at once: those of the lines
/// visible at the start of one of them.
fn most_shown(lines: &[Line]) -> (usize, usize) {
    let mut most = (0, 0);
    for line in lines {
        let (mut words, mut letters) = (0, 0);
        for other in lines.iter().filter(|o| o.t <= line.t && line.t < o.gone) {
            words += other.words.len();
            letters += other.words.iter().map(|w| w.text.chars().count()).sum::<usize>();
        }
        most = (most.0.max(words), most.1.max(letters));
    }
    most
}

/// A seeded random number generator, 0 <= x < 1: mulberry32, as lyric-words.mjs's.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Random(u32);

impl Random {
    pub fn new(seed: u32) -> Self {
        Random(seed)
    }

    pub fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        (t ^ (t >> 14)) as f64 / 4_294_967_296.0
    }
}

/// The last position reading: the song time, when on the core's clock, and the playback rate.
#[derive(Clone, Copy, Debug)]
struct Anchor {
    position: f64,
    at: f64,
    rate: f64,
}

/// A word shown: where it landed and the power of the Kick it landed with, while it is shown.
#[derive(Clone, Copy, Debug)]
struct Held {
    line: usize,
    word: usize,
    row: usize,
    ribbon: usize,
    x: f64,
    kick: f64,
}

#[derive(Clone, Copy, Debug)]
struct Kick {
    t: f64,
    power: f64,
}

/// The Lyric Line of one visualizer, fed with the track, its lyrics, position readings, whether the
/// Active Player plays, and the Kicks; `step` moves it on to a time on the core's clock.
pub(crate) struct LyricLine {
    track: Option<String>,
    length: f64,
    plain: Vec<PlainLine>,
    lines: Vec<Line>,
    anchor: Option<Anchor>,
    running: bool,
    /// The song time of the last clear: words sung before it don't pop in.
    cleared: f64,
    /// A clear (new track or lyrics) waiting for its song time: the next step takes it.
    clearing: bool,
    random: Random,
    kicks: Vec<Kick>,
    held: Vec<Held>,
    next: Vec<Held>,
    fresh: Vec<(usize, usize, f64)>,
    words: Vec<LyricWord>,
    /// The most letters the lyrics can show at once.
    letters: usize,
}

impl LyricLine {
    pub fn new() -> Self {
        LyricLine {
            track: None,
            length: 0.0,
            plain: Vec::new(),
            lines: Vec::new(),
            anchor: None,
            running: false,
            cleared: 0.0,
            clearing: false,
            random: Random::new(1),
            kicks: Vec::with_capacity(KICKS),
            held: Vec::new(),
            next: Vec::new(),
            fresh: Vec::new(),
            words: Vec::new(),
            letters: 0,
        }
    }

    pub fn seed(&mut self, seed: u32) {
        self.random = Random::new(seed);
    }

    /// The song time at `now` on the core's clock.
    pub fn position(&self, now: f64) -> f64 {
        match self.anchor {
            None => 0.0,
            Some(a) if !self.running => a.position,
            Some(a) => a.position + (now - a.at) * a.rate,
        }
    }

    /// Whether the song plays on, from `now`: the position stands still from there, or runs on.
    pub fn set_running(&mut self, running: bool, now: f64) {
        if running != self.running {
            if let Some(a) = self.anchor {
                self.anchor = Some(Anchor { position: self.position(now), at: now, ..a });
            }
            self.running = running;
        }
    }

    /// The Active Player's track: an identity and its length in seconds (0: unknown). A new
    /// identity drops the lyrics and clears the words.
    pub fn set_track(&mut self, id: &str, length: f64) {
        let changed = self.track.as_deref() != Some(id);
        if changed {
            self.track = Some(id.to_owned());
            self.plain.clear();
        }
        self.length = length;
        let lines = lyric_lines(&self.plain, self.length);
        self.take(lines, changed);
    }

    /// DMS's lyrics for the track, as JSON text. The same Lyric Lines again keep the words shown and
    /// their spots; others clear them.
    pub fn set_lyrics(&mut self, lyrics: &str) {
        let lyrics = serde_json::from_str(lyrics).unwrap_or(Value::Null);
        self.plain = plain_lines(&lyrics);
        let lines = lyric_lines(&self.plain, self.length);
        let changed = lines != self.lines;
        self.take(lines, changed);
    }

    /// Takes these Lyric Lines, clearing the words if asked, with room for the most they can show.
    fn take(&mut self, lines: Vec<Line>, clear: bool) {
        let (words, letters) = most_shown(&lines);
        self.lines = lines;
        if clear {
            self.clearing = true;
        }
        for buffer in [&mut self.held, &mut self.next] {
            buffer.reserve_exact(words.saturating_sub(buffer.len()));
        }
        self.fresh.reserve_exact(words.saturating_sub(self.fresh.len()));
        self.words.reserve_exact(words.saturating_sub(self.words.len()));
        self.letters = letters;
    }

    /// A position reading at `now` on the core's clock: the song time and the playback rate (1 =
    /// normal; not a number, 1).
    pub fn read(&mut self, position: f64, rate: f64, now: f64) {
        let position = if position.is_finite() { position } else { 0.0 };
        let rate = if rate.is_finite() { rate } else { 1.0 };
        let seek = self.anchor.is_none() || (position - self.position(now)).abs() > SEEK_TOLERANCE;
        self.anchor = Some(Anchor { position, at: now, rate });
        if seek {
            self.cleared = position;
            self.clearing = false;
            self.held.clear();
            self.kicks.clear();
        }
    }

    /// A Kick at `now` on the core's clock, with its power (0.5..1).
    pub fn kick(&mut self, power: f64, now: f64) {
        if !(power.is_finite() && power > 0.0) {
            return;
        }
        if self.kicks.len() == KICKS {
            self.kicks.remove(0);
        }
        self.kicks.push(Kick { t: self.position(now), power: power.min(1.0) });
    }

    /// The Lyric Words shown, as of the last step, in the order they were sung.
    pub fn words(&self) -> &[LyricWord] {
        &self.words
    }

    /// The most letters the lyrics can ever show at once.
    pub fn most_letters(&self) -> usize {
        self.letters
    }

    /// A shown word's text, its row's and the row's before it; empty for a word not in the lyrics.
    pub fn text(&self, word: &LyricWord) -> (&str, &str, &str) {
        match self.lines.get(word.line).and_then(|l| l.words.get(word.word)) {
            Some(w) => (&w.text, &w.row_text, &w.before),
            None => ("", "", ""),
        }
    }

    /// Whether the words still move as the song plays: it plays, and a Lyric Line is shown or to
    /// come.
    pub fn animating(&self, now: f64) -> bool {
        let now = self.position(now);
        self.running && self.lines.iter().any(|l| now < l.gone)
    }

    /// Moves the words on to `now` on the core's clock.
    pub fn step(&mut self, now: f64) {
        let now = self.position(now);
        if self.clearing {
            self.cleared = now;
            self.clearing = false;
            self.held.clear();
            self.kicks.clear();
        }
        self.kicks.retain(|k| k.t >= now - 1.0 && k.t <= now + POP_WINDOW);
        let kicks = &self.kicks;
        let kick_at =
            |t: f64| kicks.iter().filter(|k| (k.t - t).abs() <= POP_WINDOW).fold(0.0, |p: f64, k| p.max(k.power));
        self.next.clear();
        self.fresh.clear();
        self.words.clear();
        'lines: for (l, line) in self.lines.iter().enumerate() {
            if now < line.t || now >= line.gone {
                continue;
            }
            // A line that ended before the last clear stays cleared.
            if line.end < self.cleared && now >= line.end {
                continue;
            }
            let dissolve =
                if now >= line.fade { ((now - line.fade) / (line.gone - line.fade)).clamp(0.0, 1.0) } else { 0.0 };
            for (w, word) in line.words.iter().enumerate() {
                if word.t > now {
                    continue;
                }
                if self.words.len() == self.words.capacity() {
                    break 'lines;
                }
                let held = self.held.iter().find(|h| h.line == l && h.word == w).copied();
                let kick = held.map_or(0.0, |h| h.kick).max(kick_at(word.t));
                let (size, brightness) =
                    if word.background { (BACKGROUND_SIZE, BACKGROUND_BRIGHTNESS) } else { (1.0, 1.0) };
                let pop_in = if word.t < self.cleared { 1.0 } else { ((now - word.t) / POP_IN).clamp(0.0, 1.0) };
                self.words.push(LyricWord {
                    line: l,
                    word: w,
                    background: word.background,
                    size,
                    brightness,
                    pop_in,
                    pop: POP_BASE + POP_KICK * kick,
                    dissolve,
                    ribbon: held.map_or(0, |h| h.ribbon),
                    x: held.map_or(0.0, |h| h.x),
                });
                match held {
                    Some(h) => self.next.push(Held { kick, ..h }),
                    None => self.fresh.push((self.words.len() - 1, word.row, kick)),
                }
            }
        }
        // A new word lands away from all the others shown; a new row does, and its later words
        // follow its first.
        for &(i, row, kick) in &self.fresh {
            let (line, word) = (self.words[i].line, self.words[i].word);
            let lead = self.next.iter().find(|h| h.line == line && h.row == row);
            let (ribbon, x) = match lead {
                Some(h) => (h.ribbon, h.x),
                None => place(&mut self.random, &self.next),
            };
            self.words[i].ribbon = ribbon;
            self.words[i].x = x;
            self.next.push(Held { line, word, row, ribbon, x, kick });
        }
        std::mem::swap(&mut self.held, &mut self.next);
    }
}

/// A spot on the bar for a new word: of TRIES random ones, the one furthest along the bar from the
/// words `taken`.
fn place(random: &mut Random, taken: &[Held]) -> (usize, f64) {
    let (mut best, mut best_gap) = ((0, 0.0), -1.0);
    for _ in 0..TRIES {
        let ribbon = libm::floor(random.next() * RIBBONS as f64) as usize;
        let x = random.next();
        let gap = taken.iter().fold(f64::INFINITY, |gap, other| gap.min((x - other.x).abs()));
        if gap > best_gap {
            best = (ribbon, x);
            best_gap = gap;
        }
    }
    best
}

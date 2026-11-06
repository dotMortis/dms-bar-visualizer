//! The Lyric Words, in the Visualizer: the Active Player's track, lyrics and playback position in,
//! the words shown out, letter by letter as glyph instances (what lyrics/LyricWordsLayer.qml and
//! lock-ring/LockRing.qml computed per frame in v0.10.0). Their timing is lyric_line.rs's; on the
//! bar their layout and look are bar_words.rs's and the Ribbons they ride ribbons.rs's, on the Lock
//! Ring both are lock_ring/words.rs's.

use crate::bar_words::{em, lay_word, row_widths, word_look};
use crate::glyph::{Glyph, GlyphCopy};
use crate::lock_ring::{
    shockwave_crossing as ring_crossing, word_look as ring_word_look, word_placement, LockRing, PlacedLetter,
    WordScene, DIAL_RATIO, TIME_HIT_COLORS, TIME_HIT_GLOW_COLOR, TIME_HIT_SOFTEN, WORD_FONT, WORD_FONT_MIN,
    WORD_LOOK_CORE, WORD_LOOK_GLOW_RADIUS, WORD_LOOK_GLOW_SPREAD,
};
use crate::lyric_line::{LyricLine, LyricWord, Spot};
use crate::ribbons::{ribbon_color, shockwave_crossing, RibbonInputs};
use crate::{Frame, Visualizer};

/// A letter's advance, in ems, when set_letters didn't give it.
pub const FALLBACK_ADVANCE: f64 = 0.5;
/// The font's line height, in ems, until set_letters gives it.
pub const FALLBACK_LINE_HEIGHT: f64 = 1.2;
/// The largest bar (pixels either way) and font measure (ems) taken: anything larger is a mistake,
/// kept from overflowing.
pub const MAX_BAR: f64 = 100_000.0;
pub const MAX_EMS: f64 = 16.0;
/// How far (in the font's line heights) a letter's middle stays from the bar's top and bottom
/// edges.
const CLEARANCE: f64 = 0.32;
/// How far toward white a word's bright core is, and the rest of the way in a flash.
const CORE_WHITE: f64 = 0.55;
/// How far a word's glow spreads beyond it per unit of glow above GLOW_SPREAD_FROM.
const GLOW_SPREAD: f64 = 0.06;
const GLOW_SPREAD_FROM: f64 = 0.5;
/// A word's glow's blur radius, and its split copies' blur, in ems.
const GLOW_RADIUS: f64 = 0.45;
const COPY_BLUR: f64 = 0.08;

/// The Lyric Words' state in a Visualizer.
pub(crate) struct BarLyrics {
    line: LyricLine,
    /// The bar's size in pixels (0 until set: no glyphs).
    width: f64,
    height: f64,
    /// Each letter's advance in ems, sorted by letter, and the font's line height in ems.
    letters: Vec<(char, f64)>,
    line_height: f64,
    /// The glyphs, as of the last display frame; room for the most letters the lyrics can show.
    glyphs: Vec<Glyph>,
    /// A word's letters' advances, in pixels, and on the Lock Ring their spots, while it's laid out.
    advances: Vec<f64>,
    placed: Vec<PlacedLetter>,
    /// The Lock Ring's side in pixels (0 until set: no glyphs on the ring).
    side: f64,
}

/// A letter's advance in `letters`, in ems.
fn advance_of(letters: &[(char, f64)], c: char) -> f64 {
    match letters.binary_search_by_key(&c, |l| l.0) {
        Ok(i) => letters[i].1,
        Err(_) => FALLBACK_ADVANCE,
    }
}

impl BarLyrics {
    pub fn new() -> Self {
        BarLyrics {
            line: LyricLine::new(),
            width: 0.0,
            height: 0.0,
            letters: Vec::new(),
            line_height: FALLBACK_LINE_HEIGHT,
            glyphs: Vec::new(),
            advances: Vec::new(),
            placed: Vec::new(),
            side: 0.0,
        }
    }

    /// A Kick the core's detector fired, at `now` on the core's clock.
    pub fn kick(&mut self, power: f64, now: f64) {
        self.line.kick(power, now);
    }

    /// Whether the Active Player plays, from `now` on.
    pub fn set_running(&mut self, running: bool, now: f64) {
        self.line.set_running(running, now);
    }

    /// Whether the words are the Lock Ring's or the bar's: a change clears them.
    pub fn set_ring(&mut self, ring: bool) {
        self.line.set_ring(ring);
        self.make_room();
    }

    pub fn animating(&self, now: f64) -> bool {
        self.line.animating(now)
    }

    /// Room for the most letters the lyrics can show at once.
    fn make_room(&mut self) {
        let most = self.line.most_letters();
        self.glyphs.reserve_exact(most.saturating_sub(self.glyphs.len()));
        self.advances.reserve_exact(most.saturating_sub(self.advances.len()));
        self.placed.reserve_exact(most.saturating_sub(self.placed.len()));
    }

    /// One display frame, at `now` on the core's clock: the words move on, and their glyphs are
    /// laid out on the Ribbons as `frame` has them, or on the Lock Ring as `ring` has it too.
    pub fn advance(&mut self, now: f64, frame: &Frame, ring: &LockRing) {
        self.line.step(now);
        self.glyphs.clear();
        if self.line.ring() {
            self.lay_out_ring(frame, ring);
            return;
        }
        if !(self.width > 0.0 && self.height > 0.0) {
            return;
        }
        let em = em(self.height);
        let clearance = self.line_height * em * CLEARANCE;
        let inputs = RibbonInputs {
            width: self.width,
            height: self.height,
            bands: &frame.bands,
            time: frame.time,
            kick: frame.kick,
            treble: frame.treble,
            flow: frame.flow,
            bass_stretch: frame.bass_stretch,
            kick_ages: &frame.kick_ages,
            kick_powers: &frame.kick_powers,
        };
        let letters = &self.letters;
        for (index, word) in self.line.words().iter().enumerate() {
            let Spot::Bar { ribbon, x } = word.spot else { continue };
            let (text, row, before) = self.line.text(word);
            let count = text.chars().count();
            if self.glyphs.len() + count > self.glyphs.capacity() || count > self.advances.capacity() {
                break;
            }
            self.advances.clear();
            self.advances.extend(text.chars().map(|c| advance_of(letters, c) * em));
            let rows = row_widths(row, before, |c| advance_of(letters, c) * em, em);
            let start = self.glyphs.len();
            let letters = lay_word(ribbon, x, &self.advances, &inputs, clearance, Some(rows));
            for (letter, c) in letters.zip(text.chars()) {
                let (x, y, angle) = (letter.x, letter.y, letter.angle);
                self.glyphs.push(Glyph {
                    letter: c as u32 as f64,
                    word: index as f64,
                    x,
                    y,
                    angle,
                    ..Glyph::default()
                });
            }
            let laid = &self.glyphs[start..];
            if laid.is_empty() {
                continue;
            }
            let middle = (laid[0].x + laid[laid.len() - 1].x) / 2.0;
            let middle_y = laid.iter().map(|g| g.y).sum::<f64>() / laid.len() as f64;
            let look = word_look(word, shockwave_crossing(middle, &inputs));
            if look.opacity.is_nan() || look.opacity <= 0.0 {
                self.glyphs.truncate(start);
                continue;
            }
            let color = ribbon_color(middle, ribbon, &inputs);
            let whiten = CORE_WHITE + (1.0 - CORE_WHITE) * look.white;
            let outward = if middle < self.width / 2.0 { -1.0 } else { 1.0 };
            for glyph in &mut self.glyphs[start..] {
                glyph.scale = look.scale;
                glyph.pivot_x = middle;
                glyph.pivot_y = middle_y;
                glyph.color = color;
                glyph.core = color.map(|c| c + (1.0 - c) * whiten);
                glyph.opacity = look.opacity.min(1.0);
                glyph.glow = look.glow;
                glyph.glow_spread = 1.0 + GLOW_SPREAD * (look.glow - GLOW_SPREAD_FROM).max(0.0);
                glyph.blur = look.blur;
                glyph.white = look.white;
                glyph.em = em;
                glyph.glow_radius = GLOW_RADIUS * em;
                glyph.copy_blur = COPY_BLUR * em;
                glyph.copies = look.copies.map(|c| GlyphCopy {
                    color: c.color,
                    dx: c.offset * em * outward,
                    dy: 0.0,
                    opacity: c.opacity,
                });
            }
        }
    }
}

impl BarLyrics {
    /// The words' glyphs on the Lock Ring, around the dial's center, as LockRing.qml laid them out.
    fn lay_out_ring(&mut self, frame: &Frame, ring: &LockRing) {
        if self.side <= 0.0 {
            return;
        }
        let f = frame;
        let (ages, powers, seeds) = (&f.kick_ages, &f.kick_powers, &f.kick_seeds);
        let scene = WordScene {
            dial_radius: self.side * DIAL_RATIO,
            values: &f.bands,
            flow: f.flow,
            time: f.time,
            treble: f.treble,
            swell: ring.frame.swell,
            kick: f.kick,
            bass_stretch: f.bass_stretch,
            kick_ages: ages,
            kick_powers: powers,
            kick_seeds: seeds,
            poses: ring.poses,
            phases: ring.frame.hand_phases,
        };
        let glow_color = hex_rgb(TIME_HIT_GLOW_COLOR);
        let copy_colors = TIME_HIT_COLORS.map(hex_rgb);
        let letters = &self.letters;
        for (index, word) in self.line.words().iter().enumerate() {
            let text = self.line.text(word).0;
            let count = text.chars().count();
            if self.glyphs.len() + count > self.glyphs.capacity() || count > self.advances.capacity() {
                break;
            }
            let em = (self.side * WORD_FONT * word.size).max(WORD_FONT_MIN);
            self.advances.clear();
            self.advances.extend(text.chars().map(|c| advance_of(letters, c) * em));
            self.placed.clear();
            self.placed.resize(count, PlacedLetter::default());
            let place = word_placement(word.spot, &self.advances, &scene, &mut self.placed);
            let look = ring_word_look(word, ring_crossing(place.radius, ages, powers, seeds, Some(place.theta)));
            if look.opacity.is_nan() || look.opacity <= 0.0 {
                continue;
            }
            let hit = look.hit;
            let tint = hit.glow_opacity * 0.6;
            let color: [f64; 3] = std::array::from_fn(|c| place.color[c] + (glow_color[c] - place.color[c]) * tint);
            let whiten = WORD_LOOK_CORE + (1.0 - WORD_LOOK_CORE) * look.white;
            let out = libm::hypot(place.x, place.y).max(1.0);
            let (out_x, out_y) = (place.x / out, place.y / out);
            let copies: [GlyphCopy; 3] = std::array::from_fn(|i| GlyphCopy {
                color: copy_colors[i],
                dx: out_x * hit.copy_offsets[i] * em,
                dy: out_y * hit.copy_offsets[i] * em,
                opacity: hit.copy_opacity,
            });
            for (letter, c) in self.placed.iter().zip(text.chars()) {
                self.glyphs.push(Glyph {
                    letter: c as u32 as f64,
                    word: index as f64,
                    x: letter.x,
                    y: letter.y,
                    angle: letter.rotation,
                    scale: look.scale,
                    pivot_x: place.x,
                    pivot_y: place.y,
                    color,
                    core: place.color.map(|c| c + (1.0 - c) * whiten),
                    opacity: look.opacity.min(1.0),
                    glow: 1.0,
                    glow_spread: hit.glow_scale + WORD_LOOK_GLOW_SPREAD,
                    blur: look.blur,
                    white: look.white,
                    em,
                    glow_radius: WORD_LOOK_GLOW_RADIUS * em,
                    copy_blur: TIME_HIT_SOFTEN * em,
                    copies,
                });
            }
        }
    }
}

/// A "#rrggbb" color's channels, 0..1.
fn hex_rgb(hex: &str) -> [f64; 3] {
    std::array::from_fn(|i| {
        u8::from_str_radix(hex.get(1 + 2 * i..3 + 2 * i).unwrap_or("0"), 16).unwrap_or(0) as f64 / 255.0
    })
}

impl Visualizer {
    /// Seeds where the Lyric Words land, for repeatable placement (the default seed is 1).
    pub fn set_seed(&mut self, seed: u32) {
        self.lyrics.line.seed(seed);
    }

    /// The Active Player's track: any identity, and its length in seconds (0: unknown). A new
    /// identity drops the lyrics and clears the words; the same one again keeps them.
    pub fn set_track(&mut self, id: &str, length: f64) {
        self.lyrics.line.set_track(id, length);
        self.lyrics.make_room();
    }

    /// The track's lyrics, as the JSON text of DMS's lyrics.get reply's result ({ found, synced,
    /// plain, instrumental }), of { state, synced } with its lyrics controller's state and lines,
    /// or of the synced lines alone; anything else (null) for none. Only synced lyrics show:
    /// plain, untimed ones never do. Lyrics giving the same Lyric Lines as before keep the words
    /// shown; others clear them. Takes effect on the next display frame. May allocate.
    pub fn set_lyrics(&mut self, lyrics: &str) {
        self.lyrics.line.set_lyrics(lyrics);
        self.lyrics.make_room();
    }

    /// A playback position reading, now: the song time in seconds and the playback rate (1 =
    /// normal). The position runs on from it at that rate while the player (set_player) plays.
    /// One more than a second off from where it ran to is a seek, which clears the words.
    pub fn set_position(&mut self, time: f64, rate: f64) {
        self.lyrics.line.read(time, rate, self.seconds);
    }

    /// The Lock Ring's side in pixels (the square it's drawn in: the smaller of its width and
    /// height), which its glyphs are laid out on, around the dial's center; none until it's set (a
    /// side that isn't above 0 is none, one above MAX_BAR is MAX_BAR).
    pub fn set_ring_size(&mut self, side: f64) {
        self.lyrics.side = if side > 0.0 { side.min(MAX_BAR) } else { 0.0 };
    }

    /// The bar's size in pixels, which the glyphs are laid out on; none until it's set (a size
    /// that isn't above 0 is none, one above MAX_BAR is MAX_BAR).
    pub fn set_bar_size(&mut self, width: f64, height: f64) {
        let size = |x: f64| if x > 0.0 { x.min(MAX_BAR) } else { 0.0 };
        (self.lyrics.width, self.lyrics.height) = (size(width), size(height));
    }

    /// The font's measures, in ems (shares of its pixel size): each of `letters`' advance, in
    /// order, and its line height. The core loads no fonts: measure the lyrics' letters at any
    /// size and divide. A letter not given is FALLBACK_ADVANCE wide; a measure that isn't a number
    /// at or above 0 is left out, one above MAX_EMS is MAX_EMS. May allocate.
    pub fn set_letters(&mut self, letters: &str, advances: &[f64], line_height: f64) {
        let mut table: Vec<(char, f64)> =
            letters.chars().zip(advances.iter().map(|&a| a.min(MAX_EMS))).filter(|&(_, a)| a >= 0.0).collect();
        table.sort_by_key(|l| l.0);
        table.dedup_by_key(|l| l.0);
        self.lyrics.letters = table;
        if line_height >= 0.0 {
            self.lyrics.line_height = line_height.min(MAX_EMS);
        }
    }

    /// The song time now, in seconds, run on from the last reading.
    pub fn song_position(&self) -> f64 {
        self.lyrics.line.position(self.seconds)
    }

    /// The Lyric Words shown, as of the last display frame, in the order they were sung.
    pub fn lyric_words(&self) -> &[LyricWord] {
        self.lyrics.line.words()
    }

    /// A shown word's text.
    pub fn word_text(&self, word: &LyricWord) -> &str {
        self.lyrics.line.text(word).0
    }

    /// A shown word's row (its DMS line's words), and the row's text before it, each word of that
    /// with a space after it.
    pub fn word_row(&self, word: &LyricWord) -> (&str, &str) {
        let (_, row, before) = self.lyrics.line.text(word);
        (row, before)
    }

    /// The Lyric Words shown as glyph instances, one per letter, as of the last display frame:
    /// laid out on the bar (set_bar_size) with the font's measures (set_letters).
    pub fn glyphs(&self) -> &[Glyph] {
        &self.lyrics.glyphs
    }
}

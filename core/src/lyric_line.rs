//! The Lyric Line's timing, apart from where its words land and how they're drawn: which Lyric
//! Words are visible at a song time, and how far each one's pop-in and the line's dissolve have
//! got. Ported from docs/lyric-words.mjs (v0.10.0).

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
    /// Where it landed, kept while it is shown: which Ribbon (0..2), and where across the bar its
    /// row lies, 0 (flush with the left edge) .. 1 (flush with the right).
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

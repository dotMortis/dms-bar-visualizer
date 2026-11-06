//! The Bar Visualizer's Lyric Words, in the Visualizer: the Active Player's track, lyrics and
//! playback position in, the words shown out. Their timing is lyric_line.rs's.

use crate::lyric_line::{LyricLine, LyricWord};
use crate::Visualizer;

/// The Lyric Words' state in a Visualizer.
pub(crate) struct BarLyrics {
    line: LyricLine,
}

impl BarLyrics {
    pub fn new() -> Self {
        BarLyrics { line: LyricLine::new() }
    }

    /// A Kick the core's detector fired, at `now` on the core's clock.
    pub fn kick(&mut self, power: f64, now: f64) {
        self.line.kick(power, now);
    }

    /// Whether the Active Player plays, from `now` on.
    pub fn set_running(&mut self, running: bool, now: f64) {
        self.line.set_running(running, now);
    }

    /// One display frame, at `now` on the core's clock.
    pub fn advance(&mut self, now: f64) {
        self.line.step(now);
    }

    pub fn animating(&self, now: f64) -> bool {
        self.line.animating(now)
    }
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
    }

    /// The track's lyrics, as the JSON text of DMS's lyrics.get reply's result ({ found, synced,
    /// plain, instrumental }), of { state, synced } with its lyrics controller's state and lines,
    /// or of the synced lines alone; anything else (null) for none. Only synced lyrics show:
    /// plain, untimed ones never do. Lyrics giving the same Lyric Lines as before keep the words
    /// shown; others clear them. Takes effect on the next display frame. May allocate.
    pub fn set_lyrics(&mut self, lyrics: &str) {
        self.lyrics.line.set_lyrics(lyrics);
    }

    /// A playback position reading, now: the song time in seconds and the playback rate (1 =
    /// normal). The position runs on from it at that rate while the player (set_player) plays.
    /// One more than a second off from where it ran to is a seek, which clears the words.
    pub fn set_position(&mut self, time: f64, rate: f64) {
        self.lyrics.line.read(time, rate, self.seconds);
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
}

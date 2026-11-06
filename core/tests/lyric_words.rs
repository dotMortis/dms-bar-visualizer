// Lyric Words on the bar: the words of the Lyric Line, each showing from the moment it is sung
// until the line's end, lingering, then dissolving together. Driven only the way a visualizer
// drives the core: the Active Player's track, lyrics, playback position and state, display frames
// and capture frames; checked by the words it says are shown. Ported from the bar's parts of
// tests/lyric-words.test.mjs.
use serde_json::{json, Value};
use visualizer_core::{LyricWord, Player, Visualizer, BANDS};

/// A word shown, with its text and row as the core gives them.
#[derive(Clone, Debug, PartialEq)]
struct Shown {
    text: String,
    row: String,
    before: String,
    word: LyricWord,
}

/// A Visualizer playing a song, and the display clock: seconds since it started.
struct Song {
    visualizer: Visualizer,
    wall: f64,
    from: f64,
}

/// A Visualizer playing `synced` lines (DMS's format) from song time `from`, at rate 1, for a track
/// `length` seconds long, placing words with `seed`.
fn playing_from(synced: Value, from: f64, length: f64, seed: u32) -> Song {
    let mut visualizer = Visualizer::new();
    visualizer.set_seed(seed);
    visualizer.set_track("track-1", length);
    visualizer.set_lyrics(&json!({ "state": "ready", "synced": synced }).to_string());
    visualizer.set_player(Player::Playing);
    visualizer.set_position(from, 1.0);
    Song { visualizer, wall: 0.0, from }
}

fn playing(synced: Value) -> Song {
    playing_from(synced, 0.0, 300.0, 1)
}

impl Song {
    /// Display frames up to `wall` (one, however long), then the words shown.
    fn words_at_wall(&mut self, wall: f64) -> Vec<Shown> {
        self.go(wall);
        let v = &self.visualizer;
        v.lyric_words()
            .iter()
            .map(|w| {
                let (row, before) = v.word_row(w);
                Shown { text: v.word_text(w).to_owned(), row: row.to_owned(), before: before.to_owned(), word: *w }
            })
            .collect()
    }

    fn go(&mut self, wall: f64) {
        assert!(wall >= self.wall, "the display clock runs forward: {wall} < {}", self.wall);
        self.visualizer.advance(wall - self.wall);
        self.wall = wall;
    }

    /// The display clock's time at song time `t`, played from `from` at rate 1.
    fn wall_at(&self, t: f64) -> f64 {
        t - self.from
    }

    /// The words shown at song time `t`.
    fn at(&mut self, t: f64) -> Vec<Shown> {
        self.words_at_wall(self.wall_at(t))
    }

    fn texts(&mut self, t: f64) -> Vec<String> {
        self.at(t).into_iter().map(|w| w.text).collect()
    }

    fn dissolving(&mut self, t: f64) -> Vec<String> {
        self.at(t).into_iter().filter(|w| w.word.dissolve > 0.0).map(|w| w.text).collect()
    }
}

/// A word piece of DMS's lyrics.
fn piece(t: f64, e: f64, x: &str) -> Value {
    json!({ "t": t, "e": e, "x": x })
}

mod a_word_appears_as_it_is_sung {
    use super::*;

    #[test]
    fn not_before_its_start_and_from_its_start_on() {
        let line = json!({ "t": 10, "e": 14, "x": "hold the line",
            "w": [piece(10.0, 10.5, "hold "), piece(11.0, 11.5, "the "), piece(12.0, 13.0, "line")] });
        let mut song = playing(json!([line]));
        assert!(song.texts(9.99).is_empty());
        assert_eq!(song.texts(10.0), ["hold"]);
        assert_eq!(song.texts(10.99), ["hold"]);
        assert_eq!(song.texts(11.0), ["hold", "the"]);
        assert_eq!(song.texts(12.5), ["hold", "the", "line"]);
    }
}

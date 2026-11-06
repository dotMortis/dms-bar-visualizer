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

    /// A position reading at display time `wall`: the song at `position`, playing or paused.
    fn read(&mut self, position: f64, wall: f64, rate: f64, playing: bool) {
        self.go(wall);
        self.visualizer.set_player(if playing { Player::Playing } else { Player::Paused });
        self.visualizer.set_position(position, rate);
    }

    /// A Kick of `power` (0.75 or 1) the core's own detector fires at display time `wall`: a
    /// capture frame rising from silence, the first one this Visualizer gets.
    fn kick(&mut self, power: f64, wall: f64) {
        self.go(wall);
        let count = self.visualizer.frame().kick_count;
        self.visualizer.push_bands(&[(power - 0.5) * 0.1; BANDS], 0.0);
        let frame = self.visualizer.frame();
        assert_eq!((frame.kick_count, frame.kick_power), (count + 1, power), "a Kick of {power}");
    }

    fn spots(&mut self, t: f64) -> Vec<(usize, f64)> {
        self.at(t).into_iter().map(|w| (w.word.ribbon, w.word.x)).collect()
    }
}

/// The lyrics state DMS's controller gives for `synced` lines.
fn ready(synced: Value) -> String {
    json!({ "state": "ready", "synced": synced }).to_string()
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

mod syllables {
    use super::*;

    #[test]
    fn join_into_one_word_that_starts_with_its_first_syllable() {
        let line = json!({ "t": 5, "e": 9, "x": "won-der-ful day",
            "w": [piece(5.0, 5.3, "won-"), piece(5.4, 5.7, "der-"), piece(5.8, 6.2, "ful "), piece(7.0, 8.0, "day")] });
        let mut song = playing(json!([line]));
        assert!(song.texts(4.99).is_empty());
        assert_eq!(song.texts(5.0), ["won-der-ful"]);
        assert_eq!(song.texts(6.5), ["won-der-ful"]);
        assert_eq!(song.texts(7.0), ["won-der-ful", "day"]);
    }
}

mod a_line_without_word_timing {
    use super::*;

    #[test]
    fn spreads_its_words_evenly_between_its_start_and_end() {
        let mut song = playing(json!([{ "t": 20, "e": 24, "x": "one two three four" }]));
        assert_eq!(song.texts(20.0), ["one"]);
        assert_eq!(song.texts(20.99), ["one"]);
        assert_eq!(song.texts(21.0), ["one", "two"]);
        assert_eq!(song.texts(22.0), ["one", "two", "three"]);
        assert_eq!(song.texts(23.0), ["one", "two", "three", "four"]);
    }

    #[test]
    fn so_does_a_line_whose_word_timing_doesnt_join_to_its_text() {
        let mut song = playing(json!([{ "t": 20, "e": 24, "x": "one two three four",
            "w": [piece(20.0, 20.5, "one "), piece(20.5, 21.0, "two")] }]));
        assert_eq!(song.texts(21.0), ["one", "two"]);
        assert_eq!(song.texts(22.5), ["one", "two", "three"]);
    }

    #[test]
    fn so_does_a_line_with_a_word_piece_starting_before_the_line() {
        let mut song = playing(json!([{ "t": 20, "e": 24, "x": "one two three four",
            "w": [piece(19.5, 20.0, "one "), piece(20.2, 20.4, "two "), piece(20.4, 20.6, "three "), piece(20.6, 20.8, "four")] }]));
        assert_eq!(song.texts(20.9), ["one"]);
        assert_eq!(song.texts(23.0), ["one", "two", "three", "four"]);
    }
}

// On the bar a line's words start dissolving LINGER_HOLD (1 s) after its end. (The JS tests of
// when a line ends watched them on the Lock Ring, where they start dissolving right at its end.)
mod a_line_without_an_end_time {
    use super::*;

    #[test]
    fn ends_at_its_last_words_end() {
        let mut song = playing(json!([
            { "t": 10, "x": "a b", "w": [piece(10.0, 10.5, "a "), piece(11.0, 12.0, "b")] },
            { "t": 30, "e": 32, "x": "next" },
        ]));
        assert!(song.dissolving(12.99).is_empty());
        assert_eq!(song.dissolving(13.1), ["a", "b"]);
    }

    #[test]
    fn else_at_the_next_lines_start() {
        let mut song = playing(json!([{ "t": 10, "x": "a b" }, { "t": 14, "e": 16, "x": "next" }]));
        assert_eq!(song.texts(11.99), ["a"]);
        assert_eq!(song.texts(12.0), ["a", "b"]);
        assert_eq!(song.texts(14.0), ["a", "b", "next"]);
        assert!(song.dissolving(14.99).is_empty());
        assert_eq!(song.dissolving(15.1), ["a", "b"]);
    }

    #[test]
    fn else_at_the_tracks_end() {
        let mut song = playing_from(json!([{ "t": 10, "x": "a b" }]), 0.0, 20.0, 1);
        assert_eq!(song.texts(14.99), ["a"]);
        assert_eq!(song.texts(15.0), ["a", "b"]);
        assert!(song.dissolving(20.99).is_empty());
        assert_eq!(song.dissolving(21.1), ["a", "b"]);
    }
}

mod the_end_of_a_lyric_line_on_the_bar {
    use super::*;
    use visualizer_core::lyric_line::{LINGER_DISSOLVE, LINGER_HOLD};

    /// "first" ends at 13; "second" starts at 13.3.
    fn close() -> Value {
        json!([{ "t": 10, "e": 13, "x": "first" }, { "t": 13.3, "e": 15, "x": "second" }])
    }

    #[test]
    fn its_rows_stay_whole_linger_hold_seconds_while_the_next_lines_words_come() {
        assert!(LINGER_HOLD > 0.3, "{LINGER_HOLD}");
        let mut song = playing(close());
        let during: Vec<_> =
            song.at(13.0 + LINGER_HOLD - 0.01).into_iter().map(|w| (w.text, w.word.dissolve)).collect();
        assert_eq!(during, [("first".to_owned(), 0.0), ("second".to_owned(), 0.0)]);
    }

    #[test]
    fn then_dissolve_slowly_over_linger_dissolve_seconds_and_are_gone() {
        assert!(LINGER_DISSOLVE > 1.0, "{LINGER_DISSOLVE}");
        let mut song = playing(close());
        let fade = 13.0 + LINGER_HOLD;
        let half = song.at(fade + LINGER_DISSOLVE / 2.0).into_iter().find(|w| w.text == "first").unwrap();
        assert!((half.word.dissolve - 0.5).abs() < 1e-6, "dissolve {}", half.word.dissolve);
        assert_eq!(song.texts(fade + LINGER_DISSOLVE + 0.01), ["second"]);
    }

    #[test]
    fn all_its_words_dissolve_together_and_onward() {
        let mut song = playing(json!([{ "t": 10, "e": 13, "x": "first line here",
            "w": [piece(10.0, 10.5, "first "), piece(11.0, 11.5, "line "), piece(12.0, 12.5, "here")] }]));
        let during = song.at(14.2);
        assert_eq!(during.len(), 3);
        let d = during[0].word.dissolve;
        assert!(d > 0.0 && d < 1.0, "dissolve {d}");
        assert!(during.iter().all(|w| w.word.dissolve == d), "together");
        assert!(song.at(14.5).iter().all(|w| w.word.dissolve > d), "and onward");
        assert!(song.texts(15.5).is_empty());
    }
}

mod one_lyric_line_every_part_of_it {
    use super::*;

    #[test]
    fn lead_and_background_vocals_and_every_singer_show_together_background_smaller_and_dimmer() {
        let mut song = playing(json!([
            { "t": 10, "e": 14, "x": "lead", "voice": "v1", "group": 1 },
            { "t": 10, "e": 14, "x": "duet", "voice": "v2", "group": 1 },
            { "t": 11, "e": 13, "x": "ooh", "background": true, "group": 1 },
            { "t": 10.5, "e": 14, "x": "with", "voice": "v1", "group": 1 },
        ]));
        let words = song.at(12.0);
        let mut texts: Vec<_> = words.iter().map(|w| w.text.as_str()).collect();
        texts.sort();
        assert_eq!(texts, ["duet", "lead", "ooh", "with"]);
        let lead = words.iter().find(|w| w.text == "lead").unwrap().word;
        let ooh = words.iter().find(|w| w.text == "ooh").unwrap().word;
        assert!(!lead.background);
        assert!(ooh.background);
        assert!(ooh.size < lead.size, "size {} vs {}", ooh.size, lead.size);
        assert!(ooh.brightness < lead.brightness, "brightness {} vs {}", ooh.brightness, lead.brightness);
    }

    #[test]
    fn lines_starting_together_without_a_group_are_one_lyric_line() {
        let mut song = playing(json!([
            { "t": 10, "e": 14, "x": "lead" }, { "t": 10, "e": 12, "x": "ooh", "background": true }, { "t": 11, "e": 14, "x": "later" },
        ]));
        assert_eq!(song.texts(10.5), ["lead", "ooh"]);
        // A line starting later is the next Lyric Line: it ends the first at its start, so the
        // first's words start dissolving a second later, together.
        let at = song.at(12.5);
        let words: Vec<_> = at.iter().map(|w| (w.text.as_str(), w.word.line, w.word.dissolve > 0.0)).collect();
        assert_eq!(words, [("lead", 0, true), ("ooh", 0, true), ("later", 1, false)]);
    }

    #[test]
    fn the_lyrics_controllers_grouped_lines_read_as_dmss_synced_lines() {
        let mut song = playing(json!([{ "t": 10, "e": 14,
            "parts": [{ "t": 10, "e": 14, "x": "lead" }, { "t": 10, "e": 14, "x": "ooh", "background": true }] }]));
        let words: Vec<_> = song.at(12.0).into_iter().map(|w| (w.text, w.word.background)).collect();
        assert_eq!(words, [("lead".to_owned(), false), ("ooh".to_owned(), true)]);
    }
}

mod no_synced_lyrics_no_words {
    use super::*;

    fn words_with(lyrics: &str) -> Vec<String> {
        let mut song = playing(json!([]));
        song.visualizer.set_lyrics(lyrics);
        song.visualizer.set_position(50.0, 1.0);
        song.words_at_wall(1.0).into_iter().map(|w| w.text).collect()
    }

    #[test]
    fn none_from_plain_untimed_lyrics_or_any_state_but_ready() {
        let synced = json!([{ "t": 0, "e": 100, "x": "always singing" }]);
        let cases = [
            ("plain-text lyrics only", json!({ "found": true, "synced": [], "plain": "always singing" })),
            ("an instrumental", json!({ "found": true, "instrumental": true, "synced": synced })),
            ("no lyrics found", json!({ "found": false, "synced": synced })),
            ("loading", json!({ "state": "loading", "synced": synced })),
            ("an instrumental (controller)", json!({ "state": "instrumental", "synced": synced })),
            ("none", json!({ "state": "none", "synced": synced })),
            ("an error", json!({ "state": "error", "synced": synced })),
            ("nothing at all", Value::Null),
        ];
        for (name, given) in cases {
            assert!(words_with(&given.to_string()).is_empty(), "{name}");
        }
        assert!(words_with("not json").is_empty(), "broken text");
    }

    #[test]
    fn while_a_replys_synced_lyrics_do_show() {
        let reply = json!({ "found": true, "synced": [{ "t": 0, "e": 100, "x": "always singing" }], "plain": "always singing" });
        assert_eq!(words_with(&reply.to_string()), ["always", "singing"]);
    }
}

mod the_playback_position {
    use super::*;

    #[test]
    fn runs_on_from_the_last_reading_at_the_playback_rate() {
        let mut song = playing(json!([]));
        song.read(30.0, 0.0, 1.0, true);
        song.go(2.5);
        assert_eq!(song.visualizer.song_position(), 32.5);
        song.read(32.5, 2.5, 2.0, true);
        song.go(3.5);
        assert_eq!(song.visualizer.song_position(), 34.5);
        song.read(34.5, 3.5, 0.5, true);
        song.go(5.5);
        assert_eq!(song.visualizer.song_position(), 35.5);
    }

    #[test]
    fn follows_each_new_reading() {
        let mut song = playing(json!([]));
        song.read(30.0, 0.0, 1.0, true);
        song.read(31.1, 1.0, 1.0, true);
        song.go(2.0);
        assert_eq!(song.visualizer.song_position(), 32.1);
    }

    #[test]
    fn stands_still_while_paused_or_without_a_player() {
        let mut song = playing(json!([]));
        song.read(30.0, 0.0, 1.0, false);
        song.go(60.0);
        assert_eq!(song.visualizer.song_position(), 30.0);
        song.visualizer.set_player(Player::Playing);
        song.go(61.0);
        song.visualizer.set_player(Player::None);
        song.go(70.0);
        assert_eq!(song.visualizer.song_position(), 31.0);
    }

    #[test]
    fn words_follow_the_playback_rate() {
        let mut song = playing(json!([{ "t": 10, "e": 14, "x": "one two three four" }]));
        song.read(10.0, 0.0, 2.0, true);
        let texts: Vec<_> = song.words_at_wall(0.6).into_iter().map(|w| w.text).collect();
        assert_eq!(texts, ["one", "two"]);
    }
}

mod on_pause {
    use super::*;

    #[test]
    fn the_words_freeze_none_come_none_go_none_dissolve() {
        let mut song = playing(json!([{ "t": 10, "e": 13, "x": "a b c" }]));
        let paused_at = song.wall_at(12.9);
        song.read(12.9, paused_at, 1.0, false);
        let frozen = song.words_at_wall(paused_at);
        assert_eq!(frozen.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
        for later in [1.0, 10.0, 600.0] {
            assert_eq!(song.words_at_wall(paused_at + later), frozen, "{later} s later");
        }
        assert!(!song.visualizer.frame().animating, "nothing moves");
    }

    #[test]
    fn and_carry_on_when_playback_resumes() {
        let mut song = playing(json!([{ "t": 10, "e": 13, "x": "a b c" }]));
        let paused_at = song.wall_at(10.5);
        song.read(10.5, paused_at, 1.0, false);
        song.read(10.5, paused_at + 30.0, 1.0, true);
        let texts: Vec<_> = song.words_at_wall(paused_at + 30.6).into_iter().map(|w| w.text).collect();
        assert_eq!(texts, ["a", "b"]);
    }
}

mod a_seek {
    use super::*;

    fn verse() -> Song {
        playing(
            json!([{ "t": 10, "e": 14, "x": "first one two three" }, { "t": 30, "e": 34, "x": "second one two three" }]),
        )
    }

    #[test]
    fn clears_the_words() {
        let mut song = verse();
        assert_eq!(song.texts(13.0), ["first", "one", "two", "three"]);
        song.read(20.0, 13.0, 1.0, true);
        assert!(song.words_at_wall(13.0).is_empty());
    }

    #[test]
    fn brings_back_the_current_lines_sung_words_at_once_without_pop_ins() {
        let mut song = verse();
        song.texts(13.0);
        song.read(32.5, 13.0, 1.0, true);
        let back = song.words_at_wall(13.0);
        assert_eq!(back.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["second", "one", "two"]);
        assert!(back.iter().all(|w| w.word.pop_in == 1.0));
        // The next word pops in as usual.
        let next = song.words_at_wall(13.55).into_iter().find(|w| w.text == "three").expect("three");
        assert!(next.word.pop_in > 0.0 && next.word.pop_in < 1.0, "pop_in {}", next.word.pop_in);
    }

    #[test]
    fn does_not_bring_back_a_line_that_was_already_dissolving() {
        let mut song = verse();
        song.read(14.2, 1.0, 1.0, true);
        assert!(song.words_at_wall(1.0).is_empty());
    }

    #[test]
    fn backwards_clears_too() {
        let mut song = verse();
        song.texts(33.0);
        song.read(11.5, 33.0, 1.0, true);
        let back = song.words_at_wall(33.0);
        assert_eq!(back.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["first", "one"]);
        assert!(back.iter().all(|w| w.word.pop_in == 1.0));
    }

    #[test]
    fn small_drifts_in_the_readings_are_no_seek_words_keep_popping_in() {
        let mut song = verse();
        song.texts(9.9);
        song.read(10.95, 11.0, 1.0, true);
        let word = song.words_at_wall(11.05).into_iter().find(|w| w.text == "one").expect("one");
        assert!(word.word.pop_in < 1.0, "pop_in {}", word.word.pop_in);
    }
}

mod a_track_change {
    use super::*;

    #[test]
    fn clears_the_words_until_the_new_tracks_lyrics_come() {
        let mut song = playing(json!([{ "t": 0, "e": 100, "x": "old song" }]));
        assert_eq!(song.texts(50.0), ["old", "song"]);
        song.visualizer.set_track("track-2", 200.0);
        assert!(song.texts(50.0).is_empty());
        song.visualizer.set_lyrics(&ready(json!([{ "t": 0, "e": 100, "x": "new song" }])));
        assert_eq!(song.texts(50.0), ["new", "song"]);
    }

    #[test]
    fn the_same_track_again_keeps_its_lyrics() {
        let mut song = playing(json!([{ "t": 0, "e": 100, "x": "old song" }]));
        song.visualizer.set_track("track-1", 300.0);
        assert_eq!(song.texts(50.0), ["old", "song"]);
    }
}

mod pop_in {
    use super::*;

    #[test]
    fn runs_from_the_words_start() {
        let mut song = playing(json!([{ "t": 10, "e": 14, "x": "solo" }]));
        song.texts(9.0);
        assert_eq!(song.at(10.0)[0].word.pop_in, 0.0);
        let p = song.at(10.1)[0].word.pop_in;
        assert!(p > 0.0 && p < 1.0, "{p}");
        assert_eq!(song.at(11.0)[0].word.pop_in, 1.0);
    }

    #[test]
    fn lyrics_arriving_mid_line_bring_its_sung_words_without_pop_ins() {
        let mut song = playing_from(json!([]), 11.0, 300.0, 1);
        song.words_at_wall(0.0);
        song.visualizer.set_lyrics(&ready(json!([{ "t": 10, "e": 14, "x": "one two three four" }])));
        let words: Vec<_> = song.words_at_wall(0.1).into_iter().map(|w| (w.text, w.word.pop_in)).collect();
        assert_eq!(words, [("one".to_owned(), 1.0), ("two".to_owned(), 1.0)]);
    }
}

/// A line of `count` words, one a second from song time `t`, held until a second after its last.
fn line_of(count: usize, t: f64) -> Value {
    let texts: Vec<String> = (0..count).map(|i| format!("w{i}")).collect();
    let pieces: Vec<Value> = texts
        .iter()
        .enumerate()
        .map(|(i, x)| {
            let x = if i + 1 < count { format!("{x} ") } else { x.clone() };
            piece(t + i as f64, t + i as f64 + 0.5, &x)
        })
        .collect();
    json!({ "t": t, "e": t + count as f64 + 1.0, "x": texts.join(" "), "w": pieces })
}

fn placing(synced: Value, seed: u32) -> Song {
    playing_from(synced, 0.0, 300.0, seed)
}

mod placement_on_the_bar_visualizer_ribbons_only {
    use super::*;

    #[test]
    fn every_word_lands_on_one_of_the_three_ribbons_somewhere_across_the_bar() {
        for seed in 1..=20 {
            let spots = placing(json!([line_of(12, 10.0)]), seed).spots(22.5);
            assert_eq!(spots.len(), 12);
            for (ribbon, x) in spots {
                assert!(ribbon < 3 && (0.0..=1.0).contains(&x), "seed {seed}: {ribbon} {x}");
            }
        }
    }

    #[test]
    fn a_rows_later_words_follow_its_first_on_its_ribbon_at_its_spot_after_the_words_before_them() {
        for seed in 1..=20 {
            let words = placing(json!([line_of(4, 10.0)]), seed).at(13.5);
            let first = &words[0];
            for w in &words {
                assert_eq!((w.word.ribbon, w.word.x, w.row.as_str()), (first.word.ribbon, first.word.x, "w0 w1 w2 w3"));
            }
            let befores: Vec<_> = words.iter().map(|w| w.before.as_str()).collect();
            assert_eq!(befores, ["", "w0 ", "w0 w1 ", "w0 w1 w2 "]);
        }
    }

    #[test]
    fn each_line_of_a_lyric_line_is_its_own_row() {
        let lines = json!([{ "t": 10, "e": 14, "x": "lead line", "group": 1 }, { "t": 10.5, "e": 14, "x": "ooh", "background": true, "group": 1 }]);
        let mut rows: Vec<_> = placing(lines, 1).at(13.0).into_iter().map(|w| (w.text, w.row, w.before)).collect();
        rows.sort();
        let expected = [("lead", "lead line", ""), ("line", "lead line", "lead "), ("ooh", "ooh", "")];
        assert_eq!(rows, expected.map(|(a, b, c)| (a.to_owned(), b.to_owned(), c.to_owned())));
    }

    #[test]
    fn a_new_row_lands_away_from_the_rows_already_shown() {
        // Twelve random spots across the bar all within 0.2 of the first row: about 1 in 60000.
        for seed in 1..=100 {
            let lines = json!([{ "t": 10, "e": 14, "x": "lead", "group": 1 }, { "t": 10.5, "e": 14, "x": "ooh", "background": true, "group": 1 }]);
            let spots = placing(lines, seed).spots(11.0);
            assert!((spots[0].1 - spots[1].1).abs() >= 0.2, "seed {seed}: {spots:?}");
        }
    }

    #[test]
    fn there_is_no_limit_with_no_free_space_left_words_overlap() {
        let spots = placing(json!([line_of(60, 10.0)]), 1).spots(69.5);
        assert_eq!(spots.len(), 60);
        assert!(spots.iter().all(|&(ribbon, x)| ribbon < 3 && (0.0..=1.0).contains(&x)));
    }

    #[test]
    fn a_word_keeps_its_spot_while_it_is_shown() {
        let mut song = placing(json!([line_of(4, 10.0)]), 7);
        let early = song.spots(11.5);
        let later = song.spots(14.5);
        assert_eq!(later[..2], early);
    }
}

mod placement_after_the_words_clear {
    use super::*;

    #[test]
    fn the_words_that_are_gone_dont_keep_new_ones_away() {
        // Two one-word lines, the second long after the first has gone: across seeds, the second
        // word sometimes lands right where the first was.
        let mut close = 0;
        for seed in 1..=100 {
            let mut song = placing(json!([{ "t": 10, "e": 11, "x": "gone" }, { "t": 20, "e": 21, "x": "new" }]), seed);
            let gone = song.spots(10.5)[0];
            assert!(song.spots(15.0).is_empty());
            let fresh = song.spots(20.5)[0];
            close += ((gone.1 - fresh.1).abs() < 0.1) as usize;
        }
        assert!(close > 0);
    }

    #[test]
    fn the_same_lyrics_set_again_keep_the_words_and_their_spots() {
        let synced = json!([line_of(4, 10.0)]);
        for seed in 1..=20 {
            let mut song = placing(synced.clone(), seed);
            let before = song.at(12.5);
            // DMS's background refresh: equal lyrics, fresh text.
            song.visualizer.set_lyrics(&ready(synced.clone()));
            assert_eq!(song.at(12.5), before, "seed {seed}");
        }
    }

    #[test]
    fn a_seek_places_the_words_it_brings_back_afresh() {
        let mut moved = 0;
        for seed in 1..=20 {
            let mut song = placing(json!([{ "t": 10, "e": 14, "x": "here" }]), seed);
            let before = song.spots(10.5)[0];
            song.read(10.5, 30.0, 1.0, true);
            let after = song.words_at_wall(30.0)[0].word;
            moved += (after.x != before.1) as usize;
        }
        assert!(moved > 0);
    }

    #[test]
    fn a_new_tracks_words_dont_take_the_old_tracks_spots() {
        let mut moved = 0;
        for seed in 1..=20 {
            let mut song = placing(json!([{ "t": 10, "e": 14, "x": "old" }]), seed);
            let before = song.spots(10.5)[0];
            song.visualizer.set_track("track-2", 300.0);
            song.visualizer.set_lyrics(&ready(json!([{ "t": 10, "e": 14, "x": "new" }])));
            let after = song.spots(10.6)[0];
            moved += (after.1 != before.1) as usize;
        }
        assert!(moved > 0);
    }
}

mod the_pop {
    use super::*;

    /// Two words, at song times 10 and 11.
    fn two() -> Song {
        playing(json!([line_of(2, 10.0)]))
    }

    fn pop_of(song: &mut Song, text: &str, t: f64) -> f64 {
        song.at(t).into_iter().find(|w| w.text == text).expect(text).word.pop
    }

    #[test]
    fn every_word_pops() {
        assert!(pop_of(&mut two(), "w0", 10.0) > 0.0);
    }

    #[test]
    fn a_word_arriving_with_a_kick_pops_harder_than_one_without() {
        let mut song = two();
        song.kick(1.0, 10.0);
        assert!(pop_of(&mut song, "w0", 10.05) > pop_of(&mut song, "w1", 11.05));
    }

    #[test]
    fn so_does_one_whose_kick_is_detected_just_after_it_lands() {
        let mut song = two();
        song.at(10.0);
        song.kick(1.0, 10.05);
        assert!(pop_of(&mut song, "w0", 10.1) > pop_of(&mut song, "w1", 11.1));
    }

    #[test]
    fn a_word_keeps_its_pop_while_it_is_shown() {
        let mut song = playing(json!([line_of(8, 10.0)]));
        song.kick(1.0, 10.0);
        let early = pop_of(&mut song, "w0", 10.05);
        assert_eq!(pop_of(&mut song, "w0", 17.5), early);
    }

    #[test]
    fn a_harder_kick_pops_harder() {
        let (mut soft, mut hard) = (two(), two());
        soft.kick(0.75, 10.0);
        hard.kick(1.0, 10.0);
        assert!(pop_of(&mut hard, "w0", 10.05) > pop_of(&mut soft, "w0", 10.05));
    }

    #[test]
    fn a_kick_well_before_or_after_a_word_doesnt_make_it_pop_harder() {
        let plain = pop_of(&mut two(), "w0", 10.05);
        let mut before = two();
        before.kick(1.0, 9.5);
        assert_eq!(pop_of(&mut before, "w0", 10.05), plain);
        let mut after = two();
        after.kick(1.0, 10.6);
        assert_eq!(pop_of(&mut after, "w0", 10.7), plain);
    }

    #[test]
    fn a_kick_before_a_seek_doesnt_count_after_it() {
        let mut song = two();
        song.kick(1.0, 10.0);
        song.read(0.0, 10.01, 1.0, true);
        let plain = pop_of(&mut two(), "w0", 10.05);
        let w0 = song.words_at_wall(10.01 + 10.05).into_iter().find(|w| w.text == "w0").unwrap();
        assert_eq!(w0.word.pop, plain);
    }
}

mod placement_is_seeded {
    use super::*;

    fn run(seed: u32) -> Vec<(usize, f64)> {
        placing(json!([line_of(6, 10.0)]), seed).spots(16.0)
    }

    #[test]
    fn the_same_seed_gives_the_same_placement() {
        assert_eq!(run(42), run(42));
    }

    #[test]
    fn another_seed_gives_another() {
        assert_ne!(run(42), run(43));
    }
}

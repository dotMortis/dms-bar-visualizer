// Lyric Words on the Lock Ring: only one Lyric Line shows at a time; its words dissolve from its
// end and are gone by the next line's first word, and each word lands on a Ribbon or a Hand. Driven
// as a Lock Ring drives the core: the Lock Ring kind, the track, lyrics, playback position and
// state, display frames; checked by the words it says are shown. Ported from the Lock Ring's parts
// of tests/lyric-words.test.mjs (the timing shared with the bar is in lyric_words.rs).
use serde_json::{json, Value};
use visualizer_core::{Kind, LyricWord, Player, Spot, Visualizer};

/// A Lock Ring playing a song, and the display clock: seconds since it started (song time - from).
struct Song {
    visualizer: Visualizer,
    wall: f64,
}

/// A Lock Ring playing `synced` lines (DMS's format) from song time 0 at rate 1, for a track
/// `length` seconds long, placing words with `seed`.
fn playing_with(synced: Value, length: f64, seed: u32) -> Song {
    let mut visualizer = Visualizer::new();
    visualizer.set_kind(Kind::LockRing);
    visualizer.set_seed(seed);
    visualizer.set_track("track-1", length);
    visualizer.set_lyrics(&json!({ "state": "ready", "synced": synced }).to_string());
    visualizer.set_player(Player::Playing);
    visualizer.set_position(0.0, 1.0);
    Song { visualizer, wall: 0.0 }
}

fn playing(synced: Value) -> Song {
    playing_with(synced, 300.0, 1)
}

impl Song {
    /// Display frames up to song time `t` (one, however long), then the words shown.
    fn at(&mut self, t: f64) -> Vec<(String, LyricWord)> {
        assert!(t >= self.wall, "the display clock runs forward: {t} < {}", self.wall);
        self.visualizer.advance(t - self.wall);
        self.wall = t;
        let v = &self.visualizer;
        v.lyric_words().iter().map(|w| (v.word_text(w).to_owned(), *w)).collect()
    }

    fn texts(&mut self, t: f64) -> Vec<String> {
        self.at(t).into_iter().map(|w| w.0).collect()
    }

    fn dissolving(&mut self, t: f64) -> Vec<String> {
        self.at(t).into_iter().filter(|w| w.1.dissolve > 0.0).map(|w| w.0).collect()
    }

    fn spots(&mut self, t: f64) -> Vec<Spot> {
        self.at(t).into_iter().map(|w| w.1.spot).collect()
    }
}

fn piece(t: f64, e: f64, x: &str) -> Value {
    json!({ "t": t, "e": e, "x": x })
}

mod the_end_of_a_lyric_line_on_the_lock_ring {
    use super::*;

    fn verse() -> Value {
        json!([
            { "t": 10, "e": 13, "x": "first line here",
              "w": [piece(10.0, 10.5, "first "), piece(11.0, 11.5, "line "), piece(12.0, 12.5, "here")] },
            { "t": 20, "e": 22, "x": "second line" },
        ])
    }

    #[test]
    fn all_its_words_dissolve_together_and_are_gone_soon_after() {
        let mut song = playing(verse());
        let before: Vec<f64> = song.at(12.9).iter().map(|w| w.1.dissolve).collect();
        assert_eq!(before, [0.0, 0.0, 0.0]);
        let during: Vec<f64> = song.at(13.2).iter().map(|w| w.1.dissolve).collect();
        assert_eq!(during.len(), 3);
        assert!(during[0] > 0.0 && during[0] < 1.0, "dissolve {}", during[0]);
        assert!(during.iter().all(|&d| d == during[0]), "together: {during:?}");
        assert!(song.at(13.5).iter().all(|w| w.1.dissolve > during[0]), "and onward");
        assert!(song.texts(14.0).is_empty());
    }

    #[test]
    fn nothing_shows_between_lines() {
        let mut song = playing(verse());
        for t in [14.0, 16.0, 19.99] {
            assert!(song.texts(t).is_empty(), "at {t}");
        }
        assert_eq!(song.texts(20.0), ["second"]);
    }

    fn cut_in() -> Value {
        json!([
            { "t": 10, "e": 16, "x": "long line" },
            { "t": 12, "e": 14, "x": "cut in" },
            { "t": 14, "e": 15, "x": "back to back" },
        ])
    }

    #[test]
    fn no_two_lines_are_ever_visible_together() {
        let mut song = playing(cut_in());
        for i in 0..=160 {
            let t = 9.0 + i as f64 * 0.05;
            let mut lines: Vec<usize> = song.at(t).iter().map(|w| w.1.line).collect();
            lines.dedup();
            assert!(lines.len() <= 1, "at {t:.2}: lines {lines:?}");
        }
        let mut song = playing(cut_in());
        assert_eq!(song.texts(11.99), ["long"]);
        assert_eq!(song.texts(12.0), ["cut"]);
        assert_eq!(song.texts(14.0), ["back"]);
    }

    #[test]
    fn a_line_whose_next_one_comes_soon_dissolves_in_the_time_left_before_it() {
        // The first line ends at 13 and the next starts at 13.3: a 0.3 s dissolve, not the full one.
        let mut song = playing(json!([{ "t": 10, "e": 13, "x": "first" }, { "t": 13.3, "e": 15, "x": "second" }]));
        assert_eq!(song.at(12.99)[0].1.dissolve, 0.0);
        let half = song.at(13.15);
        assert_eq!(half.iter().map(|w| w.0.as_str()).collect::<Vec<_>>(), ["first"]);
        assert!((half[0].1.dissolve - 0.5).abs() < 1e-6, "dissolve {}", half[0].1.dissolve);
        assert!(song.at(13.29)[0].1.dissolve > 0.9);
        assert_eq!(song.texts(13.3), ["second"]);
    }

    #[test]
    fn lines_starting_together_without_a_group_are_one_lyric_line_a_later_one_takes_over() {
        let mut song = playing(json!([
            { "t": 10, "e": 14, "x": "lead" },
            { "t": 10, "e": 12, "x": "ooh", "background": true },
            { "t": 11, "e": 14, "x": "later" },
        ]));
        assert_eq!(song.texts(10.5), ["lead", "ooh"]);
        assert_eq!(song.texts(11.5), ["later"]);
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

/// The spots of a line of `count` words, all shown, with `seed`.
fn spots_of(count: usize, seed: u32) -> Vec<Spot> {
    playing_with(json!([line_of(count, 10.0)]), 300.0, seed).spots(10.0 + count as f64)
}

mod placement_on_the_lock_ring_ribbons_or_hands {
    use super::*;

    fn spots() -> Vec<Spot> {
        (1..=20).flat_map(|seed| spots_of(8, seed)).collect()
    }

    #[test]
    fn words_land_on_ribbons_around_the_ring_and_on_every_hand_along_it_and_nowhere_else() {
        let spots = spots();
        let (mut ribbons, mut hands) = (0, [0; 3]);
        for spot in &spots {
            match *spot {
                Spot::Ribbon { ribbon, angle } => {
                    assert!(ribbon < 3 && (0.0..360.0).contains(&angle), "{spot:?}");
                    ribbons += 1;
                }
                Spot::Hand { hand, along } => {
                    assert!(hand < 3 && (0.0..=1.0).contains(&along), "{spot:?}");
                    hands[hand] += 1;
                }
                Spot::Bar { .. } => panic!("on the bar: {spot:?}"),
            }
        }
        assert!(ribbons > 0);
        assert!(hands.iter().all(|&n| n > 0), "every Hand: {hands:?}");
    }

    #[test]
    fn about_hand_share_of_the_words_land_on_a_hand_however_many_share_the_line() {
        for count in [1, 3, 10] {
            let all: Vec<Spot> = (1..=300).flat_map(|seed| spots_of(count, seed)).collect();
            let share = all.iter().filter(|s| matches!(s, Spot::Hand { .. })).count() as f64 / all.len() as f64;
            assert!((share - 0.35).abs() < 0.05, "{count} words a line: {share} on a Hand");
        }
    }

    #[test]
    fn a_new_word_lands_away_from_the_words_already_shown() {
        for seed in 1..=100 {
            let spots = spots_of(2, seed);
            match (spots[0], spots[1]) {
                (Spot::Ribbon { angle: a, .. }, Spot::Ribbon { angle: b, .. }) => {
                    let d = (a - b).abs() % 360.0;
                    assert!(d.min(360.0 - d) >= 36.0, "seed {seed}: {a} {b}");
                }
                (Spot::Hand { hand: h, along: a }, Spot::Hand { hand: k, along: b }) if h == k => {
                    assert!((a - b).abs() >= 0.2, "seed {seed}: {a} {b}");
                }
                _ => {}
            }
        }
    }

    #[test]
    fn every_word_lands_on_its_own_spot_no_rows() {
        let spots = spots_of(4, 3);
        for (i, a) in spots.iter().enumerate() {
            assert!(spots[i + 1..].iter().all(|b| b != a), "{spots:?}");
        }
    }

    #[test]
    fn a_word_keeps_its_spot_while_it_is_shown() {
        let mut song = playing_with(json!([line_of(4, 10.0)]), 300.0, 7);
        let early = song.spots(11.5);
        let later = song.spots(14.5);
        assert_eq!(later[..2], early);
    }

    #[test]
    fn the_spots_are_v0_10_0s_for_the_same_seed() {
        // docs/lyric-words.mjs (v0.10.0), "ribbons-or-hands", seed 42, a line of five words: the
        // same random draws in the same order give the same spots, bit for bit.
        let expected = [
            Spot::Ribbon { ribbon: 1, angle: 306.88768565654755 },
            Spot::Hand { hand: 0, along: 0.7835472931619734 },
            Spot::Hand { hand: 1, along: 0.6807689322158694 },
            Spot::Ribbon { ribbon: 2, angle: 112.79001728631556 },
            Spot::Ribbon { ribbon: 0, angle: 226.4052201155573 },
        ];
        assert_eq!(spots_of(5, 42), expected);
    }

    #[test]
    fn the_same_seed_gives_the_same_placement_another_seed_another() {
        assert_eq!(spots_of(6, 5), spots_of(6, 5));
        assert_ne!(spots_of(6, 5), spots_of(6, 6));
    }
}

// On the Lock Ring a line's words start dissolving right at its end.
mod a_line_without_an_end_time {
    use super::*;

    #[test]
    fn ends_at_its_last_words_end() {
        let mut song = playing(json!([
            { "t": 10, "x": "a b", "w": [piece(10.0, 10.5, "a "), piece(11.0, 12.0, "b")] },
            { "t": 30, "e": 32, "x": "next" },
        ]));
        assert!(song.dissolving(11.99).is_empty());
        assert_eq!(song.dissolving(12.1), ["a", "b"]);
    }

    #[test]
    fn else_at_the_next_lines_start() {
        let mut song = playing(json!([{ "t": 10, "x": "a b" }, { "t": 14, "e": 16, "x": "next" }]));
        assert_eq!(song.texts(11.99), ["a"]);
        assert_eq!(song.texts(12.0), ["a", "b"]);
        assert_eq!(song.texts(13.99), ["a", "b"]);
        assert!(song.dissolving(13.99).is_empty());
        assert_eq!(song.texts(14.0), ["next"]);
    }

    #[test]
    fn else_at_the_tracks_end() {
        let mut song = playing_with(json!([{ "t": 10, "x": "a b" }]), 20.0, 1);
        assert_eq!(song.texts(14.99), ["a"]);
        assert_eq!(song.texts(15.0), ["a", "b"]);
        assert!(song.dissolving(19.99).is_empty());
        assert_eq!(song.dissolving(20.1), ["a", "b"]);
    }
}

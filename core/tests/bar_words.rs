// Lyric Words on the Bar Visualizer, apart from drawing: where each letter of a word sits as it
// rides its Ribbon, and how the word looks as it pops in, takes a Shockwave and dissolves. Ported
// from tests/bar-words.test.mjs.
use visualizer_core::bar_words::*;
use visualizer_core::ribbons::{ribbon_height, RibbonInputs};
use visualizer_core::LyricWord;

fn near(actual: f64, expected: f64, msg: &str) {
    assert!((actual - expected).abs() < 1e-6, "{msg} {actual} != {expected}");
}

const ZERO: [f64; 32] = [0.0; 32];
const ONE: [f64; 32] = [1.0; 32];

/// An 800 x 40 bar, waving at full level.
fn loud() -> RibbonInputs<'static> {
    RibbonInputs {
        width: 800.0,
        height: 40.0,
        bands: &ONE,
        time: 0.0,
        kick: 0.0,
        treble: 0.0,
        flow: 0.0,
        bass_stretch: 1.0,
        kick_ages: &[],
        kick_powers: &[],
    }
}

fn quiet() -> RibbonInputs<'static> {
    RibbonInputs { bands: &ZERO, ..loud() }
}

/// A five-letter word, each letter 10 px wide.
const WORD: [f64; 5] = [10.0; 5];

fn lay(ribbon: usize, x: f64, inputs: &RibbonInputs, clearance: f64) -> Vec<Letter> {
    lay_word(ribbon, x, &WORD, inputs, clearance, None).collect()
}

fn xs(letters: &[Letter]) -> Vec<f64> {
    letters.iter().map(|l| l.x).collect()
}

mod a_lyric_word_on_the_bar {
    use super::*;

    #[test]
    fn sits_across_the_bar_where_its_spot_says_its_letters_side_by_side() {
        assert_eq!(xs(&lay(0, 0.0, &quiet(), 6.0)), [5.0, 15.0, 25.0, 35.0, 45.0]);
        assert_eq!(xs(&lay(0, 1.0, &quiet(), 6.0)), [755.0, 765.0, 775.0, 785.0, 795.0]);
        near(lay(0, 0.5, &quiet(), 6.0)[2].x, 400.0, "in the middle:");
    }

    #[test]
    fn in_a_row_sits_after_the_words_before_it_the_whole_row_placed_across_the_bar() {
        // A 200 px row, 100 px of it before this word.
        let row = Some(RowWidths { width: 200.0, before: 100.0 });
        let at = |x| xs(&lay_word(0, x, &WORD, &quiet(), 6.0, row).collect::<Vec<_>>());
        assert_eq!(at(0.0), [105.0, 115.0, 125.0, 135.0, 145.0]);
        assert_eq!(at(1.0), [705.0, 715.0, 725.0, 735.0, 745.0]);
    }

    #[test]
    fn a_rows_words_stand_look_space_ems_apart_wider_than_a_space() {
        // Letters 10 px wide, a 20 px em: "ab cd" is two 20 px words and one gap.
        let row = row_widths("ab cd", "ab ", |_| 10.0, 20.0);
        const { assert!(LOOK_SPACE * 20.0 > 10.0, "wider than the font's space") };
        assert_eq!(row, RowWidths { width: 40.0 + LOOK_SPACE * 20.0, before: 20.0 + LOOK_SPACE * 20.0 });
    }

    #[test]
    fn a_row_wider_than_the_bar_starts_at_its_left_edge() {
        let row = Some(RowWidths { width: 1000.0, before: 50.0 });
        assert_eq!(lay_word(0, 0.7, &WORD, &quiet(), 6.0, row).next().unwrap().x, 55.0);
    }

    #[test]
    fn lies_along_the_middle_of_the_bar_on_a_flat_ribbon() {
        for g in lay(1, 0.3, &quiet(), 6.0) {
            near(g.y, 20.0, "");
            near(g.angle, 0.0, "");
        }
    }

    /// Where a letter at `x` on `ribbon` follows its Ribbon to: LOOK_FOLLOW of its offset from the
    /// bar's middle (20 px), if that stays within reach.
    fn followed(x: f64, ribbon: usize, inputs: &RibbonInputs) -> f64 {
        20.0 + LOOK_FOLLOW * (ribbon_height(x, ribbon, inputs) * 40.0 - 20.0)
    }

    #[test]
    fn follows_its_ribbons_wave_part_way_tilted_with_it_but_less() {
        const { assert!(LOOK_FOLLOW > 0.0 && LOOK_FOLLOW < 1.0) };
        let loud = loud();
        let glyphs = lay(0, 0.52, &loud, 0.0);
        let within: Vec<_> = glyphs.iter().filter(|g| (g.y - 20.0).abs() < LOOK_REACH * 40.0 - 1e-6).collect();
        assert!(!within.is_empty(), "some letters within reach");
        for g in within {
            near(g.y, followed(g.x, 0, &loud), &format!("letter at {}:", g.x));
            let rise = (ribbon_height(g.x + 1.0, 0, &loud) - ribbon_height(g.x - 1.0, 0, &loud)) * 40.0;
            let ribbon_tilt = rise.atan2(2.0).to_degrees();
            assert_eq!(g.angle.signum(), ribbon_tilt.signum(), "letter at {} tilts with the Ribbon", g.x);
            assert!(g.angle.abs() <= ribbon_tilt.abs(), "but less: {} vs {ribbon_tilt}", g.angle);
        }
    }

    #[test]
    fn rides_its_own_ribbon() {
        let a = lay(1, 0.5, &quiet(), 0.0)[2];
        let b = lay(2, 0.5, &loud(), 0.0)[2];
        near(a.y, followed(400.0, 1, &quiet()), "");
        assert_eq!((b.y - 20.0).signum(), (ribbon_height(400.0, 2, &loud()) * 40.0 - 20.0).signum(), "to its side");
    }

    #[test]
    fn moves_with_the_ribbons_wave() {
        let before = lay(0, 0.6, &loud(), 0.0);
        let after = lay(0, 0.6, &RibbonInputs { flow: 1.0, ..loud() }, 0.0);
        assert_eq!(xs(&after), xs(&before), "stays where it landed across the bar");
        assert_ne!(after[0].y, before[0].y, "but goes up and down with the wave");
    }

    fn crest() -> RibbonInputs<'static> {
        RibbonInputs { kick_ages: &[0.0], kick_powers: &[1.0], kick: 1.0, ..loud() }
    }

    #[test]
    fn strays_at_most_look_reach_of_the_bars_height_from_its_middle_even_on_a_crest() {
        const { assert!(LOOK_REACH > 0.0 && LOOK_REACH < 0.5) };
        let mut farthest: f64 = 0.0;
        for i in 0..=20 {
            for ribbon in 0..3 {
                for g in lay(ribbon, i as f64 * 0.05, &crest(), 0.0) {
                    farthest = farthest.max((g.y - 20.0).abs());
                }
            }
        }
        assert!(farthest <= LOOK_REACH * 40.0 + 1e-9, "{farthest}");
        assert!(farthest > 0.0, "but still waves");
    }

    #[test]
    fn stays_inside_the_bars_thickness_on_a_crest_that_leaves_it() {
        for x in [0.0, 0.25, 0.5, 0.75, 1.0] {
            for ribbon in 0..3 {
                for g in lay(ribbon, x, &crest(), 14.0) {
                    assert!(g.y >= 14.0 && g.y <= 26.0, "{} at {x} on {ribbon}", g.y);
                }
            }
        }
    }
}

/// A settled lead vocal, but for `change`.
fn word(change: impl FnOnce(&mut LyricWord)) -> LyricWord {
    let mut word = LyricWord { size: 1.0, brightness: 1.0, pop_in: 1.0, pop: 0.4, dissolve: 0.0, ..Default::default() };
    change(&mut word);
    word
}

mod a_lyric_words_look {
    use super::*;

    #[test]
    fn pops_in_oversized_with_a_flash_then_settles_to_its_size() {
        let start = word_look(&word(|w| w.pop_in = 0.1), 0.0);
        let settled = word_look(&word(|w| w.pop_in = 1.0), 0.0);
        assert!(start.scale > 1.1, "oversized: {}", start.scale);
        assert!(start.white > 0.2, "flashing: {}", start.white);
        near(settled.scale, 1.0, "");
        near(settled.white, 0.0, "");
        near(settled.opacity, 1.0, "");
    }

    #[test]
    fn pops_harder_with_a_kick() {
        let plain = word_look(&word(|w| (w.pop_in, w.pop) = (0.2, 0.4)), 0.0);
        let kicked = word_look(&word(|w| (w.pop_in, w.pop) = (0.2, 1.0)), 0.0);
        assert!(kicked.scale > plain.scale);
        assert!(kicked.white > plain.white);
        assert!(kicked.glow > plain.glow);
    }

    #[test]
    fn a_background_vocal_is_smaller_and_dimmer() {
        let back = word_look(&word(|w| (w.size, w.brightness) = (0.7, 0.55)), 0.0);
        near(back.scale, 0.7, "");
        near(back.opacity, 0.55, "");
    }

    #[test]
    fn dissolves_to_nothing() {
        let half = word_look(&word(|w| w.dissolve = 0.5), 0.0);
        let gone = word_look(&word(|w| w.dissolve = 1.0), 0.0);
        assert!(half.opacity < 1.0 && half.opacity > 0.0);
        assert!(half.blur > 0.0, "blurring as it goes");
        near(gone.opacity, 0.0, "");
    }

    #[test]
    fn flares_and_splits_into_colored_copies_as_a_shockwave_crosses_it() {
        let calm = word_look(&word(|_| ()), 0.0);
        let hit = word_look(&word(|_| ()), 1.0);
        let half = word_look(&word(|_| ()), 0.5);
        assert!(calm.copies.iter().all(|c| c.opacity == 0.0 && c.offset == 0.0), "no copies without a Shockwave");
        assert!(hit.copies.len() >= 3);
        for (i, a) in hit.copies.iter().enumerate() {
            assert!(hit.copies[..i].iter().all(|b| b.color != a.color), "each its own color");
        }
        assert!(hit.copies.iter().all(|c| c.opacity > 0.0 && c.offset > 0.0));
        assert!(hit.copies.iter().zip(&half.copies).all(|(h, c)| h.offset > c.offset), "split farther");
        assert!(hit.white > calm.white && hit.glow > calm.glow, "and flares");
        assert!(hit.scale > half.scale && half.scale > calm.scale, "and swells with the hit");
    }

    #[test]
    fn a_full_hit_splits_its_copies_well_clear_of_the_word() {
        let hit = word_look(&word(|_| ()), 1.0);
        assert!(hit.copies.iter().map(|c| c.offset).fold(0.0, f64::max) >= 0.5, "half a letter or more");
    }
}

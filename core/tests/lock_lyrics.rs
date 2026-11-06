// The Lock Ring's Lyric Words, apart from drawing (lock_ring::word_placement, word_look): where
// each letter of a word sits on its Ribbon or Hand, the color it glows in, and how it pops in,
// takes a Shockwave and dissolves. Ported from tests/lock-lyrics.test.mjs (v0.10.0).
use visualizer_core::lock_ring::*;
use visualizer_core::{LyricWord, Spot};

const DIAL: f64 = 100.0; // px
const SILENCE: [f64; 32] = [0.0; 32];
const LOUD: [f64; 32] = [1.0; 32];
/// 03:00 local time: the hour hand points at 3 o'clock, the minute and second hands at 12.
const THREE: f64 = 3.0 * 3600.0;

/// A scene at the local time `seconds` (hands at its angles), with `values` and hand `levels`.
fn scene(seconds: f64, values: &[f64; 32], levels: [f64; 3]) -> WordScene<'_> {
    WordScene {
        dial_radius: DIAL,
        values,
        flow: 0.0,
        time: 0.0,
        treble: 0.0,
        swell: 0.0,
        kick: 0.0,
        bass_stretch: 1.4,
        kick_ages: &[],
        kick_powers: &[],
        kick_seeds: &[],
        poses: hand_poses(seconds, levels, 0.0, 1.0),
        phases: [0.0; 3],
    }
}

fn quiet() -> WordScene<'static> {
    scene(THREE, &SILENCE, [0.0; 3])
}

const FIVE: [f64; 5] = [10.0; 5]; // a five-letter word's advances, 10 px each

/// The word's letters and placement.
fn place(spot: Spot, advances: &[f64], scene: &WordScene) -> (Vec<PlacedLetter>, WordPlacement) {
    let mut letters = vec![PlacedLetter::default(); advances.len()];
    let placement = word_placement(spot, advances, scene, &mut letters);
    (letters, placement)
}

fn letters(spot: Spot, advances: &[f64], scene: &WordScene) -> Vec<PlacedLetter> {
    place(spot, advances, scene).0
}

fn dist(g: &PlacedLetter) -> f64 {
    g.x.hypot(g.y)
}

fn near(actual: f64, expected: f64, tolerance: f64, what: &str) {
    assert!((actual - expected).abs() <= tolerance, "{what}: {actual}, expected {expected} ± {tolerance}");
}

/// A rotation in degrees, folded into -180..180.
fn fold(deg: f64) -> f64 {
    ((deg % 360.0) + 540.0) % 360.0 - 180.0
}

fn ribbon(ribbon: usize, angle: f64) -> Spot {
    Spot::Ribbon { ribbon, angle }
}

fn hand(hand: usize, along: f64) -> Spot {
    Spot::Hand { hand, along }
}

mod a_word_on_a_ribbon {
    use super::*;

    #[test]
    fn sits_on_the_ribbon_by_the_dial_in_silence_farther_out_with_loud_music() {
        for g in letters(ribbon(0, 45.0), &FIVE, &quiet()) {
            near(dist(&g), DIAL, IDLE_REACH * DIAL + 1e-9, "radius in silence");
        }
        for g in letters(ribbon(0, 45.0), &FIVE, &scene(THREE, &LOUD, [0.0; 3])) {
            assert!(dist(&g) > DIAL * 1.05, "radius with music: {}", dist(&g));
        }
    }

    #[test]
    fn bends_along_the_ring_each_letter_turned_to_its_own_spots_tangent() {
        let glyphs = letters(ribbon(1, 90.0), &FIVE, &quiet());
        let mut rotations: Vec<String> = glyphs.iter().map(|g| format!("{:.3}", g.rotation)).collect();
        rotations.dedup();
        assert_eq!(rotations.len(), glyphs.len(), "every letter turned its own way");
        near(fold(glyphs[2].rotation), 90.0, 8.0, "the middle letter at 3 o'clock");
    }

    #[test]
    fn reads_left_to_right_and_upright_at_the_top_as_at_the_bottom() {
        for angle in [0.0, 180.0] {
            let glyphs = letters(ribbon(0, angle), &FIVE, &quiet());
            assert!(glyphs[0].x < glyphs[4].x, "at {angle}°, the first letter left of the last");
            near(fold(glyphs[2].rotation), 0.0, 8.0, &format!("at {angle}°, the middle letter upright"));
            assert_eq!(glyphs[2].y.signum(), if angle == 0.0 { -1.0 } else { 1.0 }, "at {angle}°");
        }
    }

    #[test]
    fn is_centered_on_its_spot_its_letters_a_letters_advance_apart() {
        let (glyphs, p) = place(ribbon(2, 30.0), &FIVE, &quiet());
        near(glyphs[2].x.atan2(-glyphs[2].y).to_degrees(), 30.0, 1.0, "the middle letter's angle");
        near(p.x.atan2(-p.y).to_degrees(), 30.0, 1.0, "the word's angle");
        for i in 1..5 {
            let gap = (glyphs[i].x - glyphs[i - 1].x).hypot(glyphs[i].y - glyphs[i - 1].y);
            near(gap, 10.0, 1.0, &format!("letters {} and {i}", i - 1));
        }
    }

    #[test]
    fn its_radius_and_direction_are_its_middles() {
        let (_, p) = place(ribbon(2, 30.0), &FIVE, &quiet());
        near(p.radius, p.x.hypot(p.y) / DIAL, 1e-12, "radius");
        near(p.theta, 30f64.to_radians(), 0.02, "theta");
        let (_, low) = place(ribbon(0, 300.0), &FIVE, &quiet());
        assert!(low.theta > std::f64::consts::PI && low.theta < std::f64::consts::TAU, "theta 0..2π: {}", low.theta);
    }
}

mod a_word_on_a_hand {
    use super::*;

    #[test]
    fn lies_along_its_hand_inside_its_reach_reading_left_to_right() {
        let s = quiet();
        let hour = s.poses[0];
        let glyphs = letters(hand(0, 0.5), &[10.0; 3], &s);
        for g in &glyphs {
            near(g.y, 0.0, 1e-6, "on the axis (a straight hand in silence)");
            assert!(g.x >= hour.inner * DIAL && g.x <= hour.length * DIAL, "within the hand: {}", g.x);
            near(fold(g.rotation), 0.0, 1e-6, "along it");
        }
        assert!(glyphs[0].x < glyphs[2].x);
    }

    #[test]
    fn turns_with_its_hand_and_still_reads_upright_on_the_left_half() {
        let left = letters(hand(0, 0.5), &FIVE, &scene(9.0 * 3600.0, &SILENCE, [0.0; 3]));
        assert!(left.iter().all(|g| g.x < 0.0), "left of the center");
        assert!(left[0].x < left[4].x, "left to right");
        near(fold(left[2].rotation), 0.0, 1e-6, "upright");

        let up = letters(hand(1, 0.5), &FIVE, &quiet());
        assert!(up.iter().all(|g| g.x.abs() < 1e-6 && g.y < 0.0), "up the minute hand at 12");
        near(fold(up[2].rotation), -90.0, 1e-6, "reading outward");
    }

    #[test]
    fn stays_on_its_hand_a_word_near_either_end_is_pulled_in_so_it_ends_there() {
        let s = quiet();
        let tip = letters(hand(0, 1.0), &[10.0; 3], &s);
        near(tip[2].x + 5.0, s.poses[0].length * DIAL, 1e-6, "the last letter's end at the tip");
        let inner = letters(hand(0, 0.0), &[10.0; 3], &s);
        near(inner[0].x - 5.0, s.poses[0].inner * DIAL, 1e-6, "the first letter's start at the inner end");
    }

    // The short hour hand can't hold a long word; words at different spots along it still land
    // apart rather than all in its middle.
    #[test]
    fn a_word_longer_than_its_hand_starts_at_the_inner_end_and_reaches_past_the_tip_by_its_spot() {
        let s = quiet();
        let at = |along| letters(hand(0, along), &[10.0; 8], &s);
        near(at(0.0)[0].x - 5.0, s.poses[0].inner * DIAL, 1e-6, "from the inner end");
        assert!(at(1.0)[0].x > at(0.0)[0].x + 10.0, "farther out for a spot near the tip");
    }

    #[test]
    fn bends_with_the_hands_wave() {
        let glyphs = letters(hand(0, 0.5), &FIVE, &scene(THREE, &SILENCE, [1.0; 3]));
        assert!(glyphs.iter().any(|g| g.y.abs() > 0.5), "off the straight axis");
    }
}

mod a_words_color {
    use super::*;

    /// A color as 8-bit channels: words glow in a color of 8-bit channels, as v0.10.0's hex did.
    fn bytes(c: [f64; 3]) -> [u8; 3] {
        c.map(|v| {
            let b = v * 255.0;
            assert!((b - b.round()).abs() < 1e-9, "an 8-bit channel: {v}");
            b.round() as u8
        })
    }

    #[test]
    fn on_a_hand_the_hands_own_lavender_mauve_pink() {
        let s = quiet();
        let colors: Vec<[u8; 3]> = (0..3).map(|h| bytes(place(hand(h, 0.5), &FIVE, &s).1.color)).collect();
        assert!(colors[0] != colors[1] && colors[1] != colors[2] && colors[0] != colors[2], "{colors:?}");
        // At full brightness: the brightest channel at 1.
        assert!(colors.iter().all(|c| c.iter().max() == Some(&255)), "{colors:?}");
    }

    #[test]
    fn on_a_ribbon_that_ribbons_at_that_spot_it_changes_around_the_ring_and_between_ribbons() {
        let s = scene(THREE, &LOUD, [0.0; 3]);
        let at = |r, angle| bytes(place(ribbon(r, angle), &FIVE, &s).1.color);
        assert_ne!(at(0, 0.0), at(1, 0.0));
        assert_ne!(at(0, 0.0), at(0, 120.0));
    }

    #[test]
    fn is_v0_10_0s() {
        // lock-ring/lyrics.mjs wordPlacement(...).color for these spots in quiet(): the Hands'
        // lavender, mauve and pink, deepened, and Ribbon 1's at 200°.
        let s = quiet();
        assert_eq!(bytes(place(hand(0, 0.5), &FIVE, &s).1.color), [0x72, 0x81, 0xff]);
        assert_eq!(bytes(place(hand(1, 0.5), &FIVE, &s).1.color), [0xa1, 0x64, 0xff]);
        assert_eq!(bytes(place(hand(2, 0.5), &FIVE, &s).1.color), [0xff, 0x93, 0xde]);
        assert_eq!(bytes(place(ribbon(1, 200.0), &FIVE, &s).1.color), [0x7d, 0x84, 0xff]);
    }

    #[test]
    fn where_it_sits_is_v0_10_0s() {
        // wordPlacement({on: "ribbon", ribbon: 1, angle: 200}, five, quiet()), to an ulp or so.
        let (glyphs, p) = place(ribbon(1, 200.0), &FIVE, &quiet());
        near(p.x, -33.78733327717775, 1e-9, "x");
        near(p.y, 92.82993524263364, 1e-9, "y");
        near(p.radius, 0.9878755370558904, 1e-12, "radius");
        near(p.theta, 3.4906585039886586, 1e-12, "theta");
        near(glyphs[0].x, -50.71786876592754, 1e-9, "first letter x");
        near(glyphs[0].y, 82.4413728608591, 1e-9, "first letter y");
        near(glyphs[0].rotation, 34.86305740952209, 1e-9, "first letter rotation");
    }
}

mod a_words_look {
    use super::*;

    fn look(change: impl FnOnce(&mut LyricWord), crossing: f64) -> RingWordLook {
        let mut word = LyricWord { pop_in: 1.0, pop: 0.4, dissolve: 0.0, brightness: 1.0, ..Default::default() };
        change(&mut word);
        word_look(&word, crossing)
    }

    #[test]
    fn pops_in_oversized_and_flashing_then_settles() {
        let (landing, settled) = (look(|w| w.pop_in = 0.0, 0.0), look(|_| {}, 0.0));
        assert!(landing.scale > 1.0, "oversized as it lands");
        assert!(landing.white > settled.white, "a flash");
        assert_eq!(settled.scale, 1.0);
        assert_eq!(settled.opacity, 1.0);
    }

    #[test]
    fn pops_harder_with_a_kick() {
        let pop = |pop_in, pop| look(|w| (w.pop_in, w.pop) = (pop_in, pop), 0.0);
        assert!(pop(0.0, 1.0).scale > pop(0.0, 0.4).scale);
        assert!(pop(0.2, 1.0).white > pop(0.2, 0.4).white);
    }

    #[test]
    fn dissolves_to_nothing_and_a_background_vocal_is_dimmer() {
        assert!(look(|w| w.dissolve = 0.5, 0.0).opacity < 1.0);
        assert_eq!(look(|w| w.dissolve = 1.0, 0.0).opacity, 0.0);
        assert!(look(|w| w.dissolve = 0.5, 0.0).blur > 0.0);
        assert!(look(|w| w.brightness = 0.55, 0.0).opacity < 1.0);
    }

    #[test]
    fn a_shockwave_crossing_it_splits_it_into_colored_copies_and_flares_it_like_the_digital_time() {
        let (calm, hit) = (look(|_| {}, 0.0), look(|_| {}, 1.0));
        assert_eq!(calm.hit.copy_opacity, 0.0);
        assert!(hit.hit.copy_opacity > 0.0 && hit.hit.copy_offsets.iter().all(|&o| o > 0.0));
        assert!(hit.white > calm.white);
        assert_eq!(hit.hit, time_hit(1.0));
    }
}

#[test]
fn words_scale_with_the_ring_smaller_than_the_digital_time() {
    assert!(WORD_FONT > 0.0 && WORD_FONT < TIME_FONT);
}

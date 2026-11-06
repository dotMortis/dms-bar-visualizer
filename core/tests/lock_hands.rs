// The Lock Ring's Hands: each one is a wave ribbon showing its own band (hour = bass, minute =
// mids, second = highs). The band swings, thickens and lights it, every Kick flashes it and pushes
// it a little, and the music never moves it off the true time. Ported from
// tests/lock-hands.test.mjs (v0.10.0); its hand motion tests are in lock_ring_frame.rs, through
// the Visualizer. Hands are in HANDS' order (hour, minute, second), levels in the bands' (bass,
// mid, treble).
use visualizer_core::lock_ring::*;

/// 10:10, local time, in seconds since midnight.
const TEN_TEN: f64 = 10.0 * 3600.0 + 10.0 * 60.0;
const SILENCE: [f64; 3] = [0.0; 3];
const NAMES: [&str; 3] = ["hour", "minute", "second"];

/// What music and Kicks change about a hand.
fn look(pose: &HandPose) -> (f64, f64, f64, f64) {
    (pose.amplitude, pose.thicken, pose.glow, pose.flash)
}

const PLAIN: (f64, f64, f64, f64) = (0.0, 1.0, 0.0, 0.0);

fn poses(levels: [f64; 3], flash: f64, strength: f64) -> [HandPose; 3] {
    hand_poses(TEN_TEN, levels, flash, strength)
}

mod hands_in_silence {
    use super::*;

    #[test]
    fn are_calm_plain_lines() {
        for (name, hand) in NAMES.iter().zip(poses(SILENCE, 0.0, 1.0)) {
            assert_eq!(look(&hand), PLAIN, "{name}");
        }
    }

    #[test]
    fn keep_their_own_length_and_plain_thickness() {
        for ((name, hand), spec) in NAMES.iter().zip(poses(SILENCE, 0.0, 1.0)).zip(HANDS) {
            assert_eq!(hand.length, spec.length, "{name} length");
            assert_eq!(hand.width, spec.thickness, "{name} width");
        }
    }
}

mod each_hand_shows_its_own_band {
    use super::*;

    #[test]
    fn each_hand_swings_thickens_and_glows_with_its_band_alone() {
        for band in 0..3 {
            let mut levels = SILENCE;
            levels[band] = 0.7;
            let poses = poses(levels, 0.0, 1.0);
            let hand = &poses[band];
            assert!(hand.amplitude > 0.0 && hand.thicken > 1.0 && hand.glow > 0.0, "{}: {hand:?}", NAMES[band]);
            for other in (0..3).filter(|&o| o != band) {
                assert_eq!(look(&poses[other]), PLAIN, "{} stays plain", NAMES[other]);
            }
        }
    }

    #[test]
    fn louder_makes_a_hand_swing_wider_thicker_and_brighter_up_to_a_cap() {
        let hour = |bass: f64| poses([bass, 0.0, 0.0], 0.0, 1.0)[0];
        let (quiet, loud, full, over) = (hour(0.2), hour(0.7), hour(1.0), hour(1.5));
        for key in [|p: &HandPose| p.amplitude, |p: &HandPose| p.thicken, |p: &HandPose| p.glow] {
            assert!(key(&loud) > key(&quiet));
            assert_eq!(key(&over), key(&full), "capped");
        }
    }

    #[test]
    fn at_full_scale_a_hand_swings_by_a_tenth_of_its_length_glows_fully_and_stays_slim() {
        for band in 0..3 {
            let mut levels = SILENCE;
            levels[band] = 1.0;
            let hand = poses(levels, 0.0, 1.0)[band];
            assert!(hand.amplitude >= 0.1 * hand.length, "{} amplitude {}", NAMES[band], hand.amplitude);
            assert_eq!(hand.glow, 1.0);
            assert!(hand.thicken > 1.0 && hand.thicken <= 1.3, "thicken {}", hand.thicken);
            assert!(hand.width <= 1.3 * HANDS[band].thickness + 1e-12, "width {}", hand.width);
        }
    }

    #[test]
    fn every_hand_is_slim() {
        for hand in HANDS {
            assert!(hand.thickness < 0.05);
        }
    }
}

mod a_kick_flashes_the_hands_and_gives_them_a_small_push {
    use super::*;

    #[test]
    fn a_kick_flashes_every_hand_swings_even_a_silent_one_a_little_and_pushes_its_tip_out() {
        for ((name, hand), spec) in NAMES.iter().zip(poses(SILENCE, 1.0, 1.0)).zip(HANDS) {
            assert!(hand.amplitude > 0.0, "{name} amplitude");
            assert!(hand.length > spec.length, "{name} length");
            assert_eq!(hand.flash, 1.0, "{name} flash");
        }
    }

    #[test]
    fn the_push_is_small() {
        let (loud, kicked) = (poses([1.0; 3], 0.0, 1.0), poses(SILENCE, 1.0, 1.0));
        for i in 0..3 {
            assert!(kicked[i].amplitude < loud[i].amplitude, "{}", NAMES[i]);
            assert!(kicked[i].length <= 1.1 * HANDS[i].length, "{} grows at most a tenth", NAMES[i]);
        }
    }

    #[test]
    fn the_hour_hand_is_pushed_less_than_the_others_for_its_length() {
        let kicked = poses(SILENCE, 1.0, 1.0);
        let swing = |i: usize| kicked[i].amplitude / HANDS[i].length;
        let reach = |i: usize| kicked[i].length / HANDS[i].length;
        assert!(swing(0) < swing(1) && swing(0) < swing(2));
        assert!(reach(0) < reach(1) && reach(0) < reach(2));
        assert!(swing(0) > 0.0 && reach(0) > 1.0, "but it is still pushed");
    }

    #[test]
    fn the_push_fades_with_the_flash() {
        let minute = |flash: f64| poses(SILENCE, flash, 1.0)[1];
        assert!(minute(1.0).amplitude > minute(0.4).amplitude && minute(0.4).amplitude > minute(0.0).amplitude);
        assert!(minute(1.0).length > minute(0.4).length && minute(0.4).length > minute(0.0).length);
        assert_eq!(minute(0.0).length, HANDS[1].length, "no kick, plain length");
    }
}

#[test]
fn wave_strength_scales_the_swing_and_at_0_the_hands_stay_straight() {
    let swing = |strength: f64| poses([1.0; 3], 1.0, strength)[0];
    assert_eq!(swing(0.0).amplitude, 0.0);
    assert!((swing(2.0).amplitude - 2.0 * swing(1.0).amplitude).abs() < 1e-12);
    assert_eq!(swing(0.0).thicken, swing(1.0).thicken, "thickness is the band's, not the wave's");
}

mod the_music_never_moves_the_hands {
    use super::*;

    #[test]
    fn at_3_00_00_in_loud_music_the_hour_hand_points_at_3_and_the_others_at_12() {
        let p = hand_poses(3.0 * 3600.0, [1.0, 0.9, 0.8], 0.0, 1.0);
        assert_eq!([p[0].angle, p[1].angle, p[2].angle], [90.0, 0.0, 0.0]);
    }

    #[test]
    fn at_9_30_15_5_the_angles_are_the_same_in_silence_quiet_and_loud_music() {
        let time = 9.0 * 3600.0 + 30.0 * 60.0 + 15.5;
        let expected = [285.0 + 15.5 / 120.0, 180.0 + 15.5 / 10.0, 93.0];
        for levels in [SILENCE, [0.3, 0.2, 0.1], [1.0, 0.9, 0.8], [5.0, -1.0, f64::NAN]] {
            for flash in [0.0, 1.0, f64::NAN] {
                let p = hand_poses(time, levels, flash, 2.0);
                for i in 0..3 {
                    assert!((p[i].angle - expected[i]).abs() < 1e-9, "{levels:?}: {} vs {}", p[i].angle, expected[i]);
                }
            }
        }
    }
}

// Floating hands: none of them reaches the center, so they never meet there.
mod the_hands_float {
    use super::*;

    #[test]
    fn every_hand_starts_a_small_gap_out_from_the_center_and_runs_out_to_its_length() {
        for (name, hand) in NAMES.iter().zip(poses([1.0; 3], 1.0, 1.0)) {
            assert!((0.08..=0.12).contains(&hand.inner), "{name} inner {}", hand.inner);
            assert!(hand.length - hand.inner > 0.3, "{name} runs out from there");
        }
    }

    #[test]
    fn the_gap_is_wider_than_any_hand() {
        for (name, hand) in NAMES.iter().zip(poses([1.0; 3], 0.0, 1.0)) {
            assert!(hand.inner > 2.0 * hand.width, "{name}: gap {}, width {}", hand.inner, hand.width);
        }
    }
}

// The wave only ever bends a hand sideways around its straight axis at the true angle. u runs along
// the hand, 0 at its inner end to 1 at the tip.
mod the_wave_bends_a_hand_around_its_axis {
    use super::*;

    #[test]
    fn there_is_no_bend_at_the_hands_inner_end() {
        assert_eq!(wave_envelope(0.0), 0.0);
        for phase in [0.0, 0.3, 1.7, 5.0] {
            assert_eq!(wave_offset(0.0, phase, 0.3, 1.0).abs(), 0.0, "phase {phase}");
        }
    }

    #[test]
    fn the_bend_is_full_along_the_middle_of_the_hand_and_small_at_the_tip() {
        assert_eq!(wave_envelope(0.5), 1.0);
        assert!(wave_envelope(1.0) > 0.0 && wave_envelope(1.0) <= 0.15, "tip {}", wave_envelope(1.0));
        for u in (0..=100).map(|i| i as f64 / 100.0) {
            assert!((0.0..=1.0).contains(&wave_envelope(u)), "envelope at {u}");
        }
    }

    #[test]
    fn the_wave_never_pushes_a_point_further_aside_than_the_amplitude_allows_there() {
        for u in (0..=50).map(|i| i as f64 * 0.02) {
            for phase in (0..19).map(|i| i as f64 * 0.37) {
                for treble in [0.0, 1.0] {
                    assert!(
                        wave_offset(u, phase, 0.2, treble).abs() <= 0.2 * wave_envelope(u) + 1e-12,
                        "u {u} phase {phase}"
                    );
                }
            }
        }
    }

    #[test]
    fn even_in_the_loudest_kick_at_full_wave_strength_the_tip_turns_a_hand_by_at_most_5_degrees() {
        for (name, hand) in NAMES.iter().zip(poses([1.0; 3], 1.0, 2.0)) {
            let degrees = libm::atan2(hand.amplitude * wave_envelope(1.0), hand.length).to_degrees();
            assert!(degrees > 0.0 && degrees <= 5.0, "{name}: {degrees:.2} degrees");
        }
    }
}

// ring.frag runs the strands at the phase times 1, 1.5 and 2, and the ripple at those times 1.7.
#[test]
fn the_phase_wraps_where_every_strands_wave_is_whole() {
    for m in [1.0, 1.5, 2.0, 1.7, 2.55, 3.4] {
        let turns = m * PHASE_WRAP / std::f64::consts::TAU;
        assert!((turns - turns.round()).abs() < 1e-9, "x{m}: {turns} turns");
    }
}

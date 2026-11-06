// The Lock Ring's clock: the Hands always point at the true time, and the second hand sweeps
// instead of ticking; the Digital Time sits where a Shockwave hits it and takes its hit. Ported
// from tests/lock-clock.test.mjs (v0.10.0). The local time comes in as seconds since local
// midnight; how the Digital Time reads (formatTime(), DMS's 12h/24h settings) stays with the host.
use visualizer_core::lock_ring::*;

/// Local wall-clock time, in seconds since midnight.
fn at(h: f64, m: f64, s: f64, ms: f64) -> f64 {
    h * 3600.0 + m * 60.0 + s + ms / 1000.0
}

mod hand_angles {
    use super::*;

    #[test]
    fn at_3_00_00_the_hour_hand_points_at_3_and_the_others_at_12() {
        assert_eq!(hand_angles(at(3.0, 0.0, 0.0, 0.0)), [90.0, 0.0, 0.0]);
    }

    #[test]
    fn at_15_00_the_hour_hand_points_at_3_like_at_3_00() {
        assert_eq!(hand_angles(at(15.0, 0.0, 0.0, 0.0)), [90.0, 0.0, 0.0]);
    }

    #[test]
    fn at_9_30_the_hour_hand_is_halfway_between_9_and_10() {
        assert_eq!(hand_angles(at(9.0, 30.0, 0.0, 0.0)), [285.0, 180.0, 0.0]);
    }

    #[test]
    fn the_minute_hand_moves_on_with_the_seconds() {
        assert_eq!(hand_angles(at(12.0, 10.0, 30.0, 0.0))[1], 63.0);
    }

    #[test]
    fn the_second_hand_sweeps() {
        assert_eq!(hand_angles(at(12.0, 0.0, 15.0, 500.0))[2], 93.0);
    }

    #[test]
    fn the_second_hand_moves_on_every_frame_within_a_second() {
        let frames: Vec<f64> = (0..60).map(|n| hand_angles(at(12.0, 0.0, 7.0, n as f64 * 1000.0 / 60.0))[2]).collect();
        for n in 1..frames.len() {
            assert!(frames[n] > frames[n - 1], "frame {n}: {} after {}", frames[n], frames[n - 1]);
        }
        assert!(frames[59] < 48.0, "still short of the next second");
    }

    #[test]
    fn just_before_midnight_every_hand_is_just_short_of_a_full_turn() {
        for angle in hand_angles(at(23.0, 59.0, 59.0, 999.0)) {
            assert!(angle < 360.0 && angle > 359.9, "{angle}");
        }
    }

    #[test]
    fn a_time_past_midnight_or_before_it_is_the_time_of_day_it_lands_on() {
        assert_eq!(hand_angles(at(27.0, 0.0, 0.0, 0.0)), [90.0, 0.0, 0.0]);
        assert_eq!(hand_angles(-at(21.0, 0.0, 0.0, 0.0)), [90.0, 0.0, 0.0]);
    }
}

// Where the Digital Time sits: a Shockwave hits it where its digits are.
#[test]
fn the_radius_a_shockwave_hits_the_digital_time_at_is_about_the_middle_of_its_digits() {
    let bottom = TIME_TOP + TIME_FONT / DIAL_RATIO; // a font size below the top
    assert!(TIME_RADIUS > TIME_TOP && TIME_RADIUS < bottom, "{TIME_TOP} < {TIME_RADIUS} < {bottom}");
    assert!((TIME_RADIUS - (TIME_TOP + bottom) / 2.0).abs() < 0.02, "{TIME_RADIUS}");
}

// A Shockwave crossing the Digital Time (shockwave_crossing() at TIME_RADIUS, 0..1) splits it into
// the Shockwave's colors and flares it with a glow. Offsets are in font sizes.
mod digital_time_hit {
    use super::*;

    #[test]
    fn at_rest_the_time_shows_no_split_and_no_glow() {
        let hit = time_hit(0.0);
        assert_eq!(hit.glow_opacity, 0.0);
        assert_eq!(hit.glow_scale, 1.0);
        assert_eq!(hit.white, 0.0);
        assert_eq!(hit.copy_offsets, [0.0; 3]);
        assert_eq!(hit.copy_opacity, 0.0);
    }

    #[test]
    fn splits_into_lavender_mauve_and_blue_copies_offset_outward_in_the_shockwaves_order() {
        assert_eq!(TIME_HIT_COLORS, ["#b4befe", "#cba6f7", "#89b4fa"]);
        let hit = time_hit(1.0);
        assert!(hit.copy_offsets.iter().all(|&o| o > 0.0) && hit.copy_opacity > 0.0, "{hit:?}");
        // Lavender leads the front, blue trails it, so lavender is pushed out farthest.
        let [lavender, mauve, blue] = hit.copy_offsets;
        assert!(lavender > mauve && mauve > blue);
    }

    #[test]
    fn stays_a_split_not_a_smear() {
        for offset in time_hit(1.0).copy_offsets {
            assert!(offset < 0.2, "{offset}");
        }
    }

    #[test]
    fn a_harder_crossing_splits_and_glows_more_and_the_faintest_one_still_shows() {
        let mut last = time_hit(0.0);
        for crossing in [0.05, 0.3, 0.6, 1.0] {
            let hit = time_hit(crossing);
            assert!(hit.glow_opacity > last.glow_opacity && hit.glow_scale > last.glow_scale, "at {crossing}");
            assert!(hit.white > last.white && hit.copy_opacity > last.copy_opacity, "at {crossing}");
            for i in 0..3 {
                assert!(hit.copy_offsets[i] > last.copy_offsets[i]);
            }
            last = hit;
        }
    }

    #[test]
    fn the_hardest_hit_glows_at_full_strength_a_little_wider_than_the_digits() {
        let hit = time_hit(1.0);
        assert_eq!(hit.glow_opacity, 1.0);
        assert!(hit.glow_scale > 1.0 && hit.glow_scale < 1.2, "{}", hit.glow_scale);
    }

    #[test]
    fn never_goes_past_the_hardest_hits_look() {
        assert_eq!(time_hit(3.0), time_hit(1.0));
        assert_eq!(time_hit(-1.0), time_hit(0.0));
        assert_eq!(time_hit(f64::NAN), time_hit(0.0));
    }
}

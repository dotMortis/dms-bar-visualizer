// The Lock Ring's look, apart from drawing: where on the ring each part of the spectrum sits, the
// calm, living ribbon that music grows into spectrum ribbons, and the 12 Hour Points riding on it.
// Ported from tests/lock-ring.test.mjs (v0.10.0); its ring motion tests are in lock_ring_frame.rs,
// through the Visualizer.
use std::f64::consts::TAU;

use visualizer_core::lock_ring::*;

fn near(actual: f64, expected: f64, what: &str) {
    assert!((actual - expected).abs() < 1e-9, "{what} {actual} != {expected}");
}

/// 0, step, 2 step, ... below `end`.
fn upto(start: f64, end: f64, step: f64) -> impl Iterator<Item = f64> {
    (0..).map(move |i| start + i as f64 * step).take_while(move |&x| x < end)
}

// Angles are clockwise degrees from 12 o'clock, like the hands. Spectrum positions run from 0
// (lowest band) to 1 (highest).
mod spectrum_around_the_ring {
    use super::*;

    #[test]
    fn bass_sits_at_the_bottom_at_6_oclock() {
        near(spectrum_at(180.0, 1.4), 0.0, "");
    }

    #[test]
    fn the_highs_meet_at_the_top_at_12_oclock() {
        near(spectrum_at(0.0, 1.4), 1.0, "");
        near(spectrum_at(360.0, 1.4), 1.0, "");
    }

    #[test]
    fn left_and_right_are_mirror_images() {
        for angle in [10.0, 45.0, 90.0, 135.0, 170.0] {
            near(spectrum_at(angle, 1.4), spectrum_at(360.0 - angle, 1.4), &format!("{angle}"));
        }
    }

    #[test]
    fn without_bass_stretch_3_and_9_oclock_show_the_middle_of_the_spectrum() {
        near(spectrum_at(90.0, 1.0), 0.5, "");
        near(spectrum_at(270.0, 1.0), 0.5, "");
    }

    #[test]
    fn bass_stretch_gives_the_bass_more_of_the_ring() {
        near(spectrum_at(90.0, 1.4), 0.5f64.powf(1.4), "");
    }

    #[test]
    fn the_spectrum_climbs_from_the_bottom_to_the_top_on_each_side() {
        for angle in (1..=36).map(|i| i as f64 * 5.0) {
            assert!(spectrum_at(angle - 5.0, 1.4) > spectrum_at(angle, 1.4), "right side at {angle}");
        }
        for angle in (36..72).map(|i| i as f64 * 5.0) {
            assert!(spectrum_at(angle + 5.0, 1.4) > spectrum_at(angle, 1.4), "left side at {angle}");
        }
    }
}

// The ribbon is the Dial. In silence it never freezes into a fixed circle: it breathes and drifts
// slowly, thin and close to the dial radius, so the clock stays readable. Music grows it into the
// full spectrum ribbons. Radii are in dial radii (1 = the dial).
mod the_living_ribbon {
    use super::*;

    fn quiet(time: f64, strand: usize) -> RibbonAt {
        RibbonAt { time, strand, ..RibbonAt::default() }
    }

    #[test]
    fn in_silence_it_is_never_a_fixed_circle() {
        for strand in 0..3 {
            let now = ribbon_radius(30.0, &quiet(10.0, strand));
            assert!((ribbon_radius(30.0, &quiet(12.0, strand)) - now).abs() > 1e-3, "strand {strand} over time");
            assert!((ribbon_radius(75.0, &quiet(10.0, strand)) - now).abs() > 1e-3, "strand {strand} around");
        }
    }

    #[test]
    fn in_silence_it_stays_calm_within_a_few_hundredths_of_the_dial() {
        assert!(IDLE_REACH <= 0.04);
        for time in upto(0.0, 60.0, 0.7) {
            for angle in upto(0.0, 360.0, 7.0) {
                for strand in 0..3 {
                    let r = ribbon_radius(angle, &quiet(time, strand));
                    assert!((r - 1.0).abs() <= IDLE_REACH + 1e-12, "{angle} at {time}: {r}");
                }
            }
        }
    }

    #[test]
    fn it_moves_slowly_in_silence() {
        for time in upto(0.0, 30.0, 1.3) {
            let (a, b) = (ribbon_radius(120.0, &quiet(time, 0)), ribbon_radius(120.0, &quiet(time + 1.0, 0)));
            assert!((b - a).abs() < IDLE_REACH, "at {time}: {a} -> {b}");
        }
    }

    #[test]
    fn the_music_grows_it_outward_into_the_spectrum_ribbons() {
        let at = RibbonAt { level: 1.0, flow: 1.0, swell: 0.08, time: 5.0, ..RibbonAt::default() };
        let most = upto(0.0, 360.0, 3.0).map(|angle| ribbon_radius(angle, &at)).fold(0.0, f64::max);
        assert!(most > 1.3, "reaches {most}");
    }

    #[test]
    fn it_is_seamless_where_the_shaders_time_wraps() {
        for angle in [0.0, 45.0, 200.0] {
            for strand in 0..3 {
                near(ribbon_radius(angle, &quiet(1200.0, strand)), ribbon_radius(angle, &quiet(0.0, strand)), &format!("{angle}"));
            }
        }
    }
}

mod the_hour_points {
    use super::*;

    fn values() -> [f64; 32] {
        std::array::from_fn(|i| (i % 5) as f64 / 5.0)
    }

    fn scene(values: &[f64]) -> RingScene<'_> {
        RingScene { values, flow: 2.0, time: 7.0, treble: 0.3, swell: 0.04, presence: 1.0, bass_stretch: 1.4 }
    }

    fn none(_: f64, _: f64) -> f64 {
        0.0
    }

    fn at(scene: &RingScene, angle: f64, level: f64) -> f64 {
        let RingScene { flow, time, treble, swell, .. } = *scene;
        ribbon_radius(angle, &RibbonAt { level, flow, time, treble, swell, strand: 0 })
    }

    /// A hard Kick `age` seconds ago: its round Shockwave crossing the ring.
    fn kicked(age: f64) -> impl Fn(f64, f64) -> f64 {
        move |r, _| shockwave_crossing(r, &[age], &[1.0], &[], None)
    }

    #[test]
    fn there_are_12_one_at_every_hour() {
        let v = values();
        let angles: Vec<f64> = hour_points(&scene(&v), none, none).iter().map(|p| p.angle).collect();
        assert_eq!(angles, (0..12).map(|i| i as f64 * 30.0).collect::<Vec<_>>());
    }

    #[test]
    fn each_rides_on_the_ribbon_at_the_ribbons_radius_at_its_hour() {
        let v = values();
        let s = scene(&v);
        for point in hour_points(&s, none, none) {
            let level = (1.3 * ribbon_level(&v, spectrum_at(point.angle, 1.4))).min(1.0);
            near(point.radius, at(&s, point.angle, level), &format!("{}", point.angle));
        }
    }

    #[test]
    fn they_move_with_the_ribbon_in_silence_too() {
        let silent = [0.0; 32];
        let now = hour_points(&RingScene { presence: 0.0, swell: 0.0, ..scene(&silent) }, none, none);
        let later = hour_points(&RingScene { presence: 0.0, swell: 0.0, time: 9.0, ..scene(&silent) }, none, none);
        assert!(now.iter().zip(&later).any(|(p, q)| (p.radius - q.radius).abs() > 1e-3));
    }

    #[test]
    fn twelve_three_six_and_nine_are_brighter() {
        let v = values();
        let points = hour_points(&scene(&v), none, none);
        for p in &points {
            if p.angle % 90.0 != 0.0 {
                assert!(p.glow < points[0].glow && p.glow > 0.0, "{}", p.angle);
            }
        }
        for i in [3, 6, 9] {
            near(points[i].glow, points[0].glow, "");
        }
    }

    #[test]
    fn a_kick_doesnt_flash_them_at_its_instant() {
        let v = values();
        let points = hour_points(&scene(&v), none, none);
        for age in [0.0, 0.05] {
            for (p, q) in hour_points(&scene(&v), kicked(age), none).iter().zip(&points) {
                near(p.glow, q.glow, &format!("{} at {age} s", p.angle));
            }
        }
    }

    #[test]
    fn each_flashes_as_the_shockwaves_front_reaches_its_radius() {
        let v = values();
        let points = hour_points(&scene(&v), none, none);
        for (i, p) in points.iter().enumerate() {
            let mut age = 0.0;
            while kick_at(age, 1.0).front < p.radius {
                age += 0.001;
            }
            assert!(hour_points(&scene(&v), kicked(age), none)[i].glow > p.glow + 0.2, "{} at {age} s", p.angle);
        }
    }

    // Each surges where its own strand is before the surge, as the ribbons do in ring.frag.
    #[test]
    fn they_ride_the_ribbon_as_a_shockwave_surges_it() {
        let v = values();
        let s = scene(&v);
        // A hard Kick whose front is at the ribbon's rest radius (1 + swell).
        let mut age = 0.0;
        while kick_at(age, 1.0).front < 1.0 + s.swell {
            age += 0.001;
        }
        let surge = move |r: f64| ribbon_surge(r, &[age], &[1.0], &[], None);
        assert!(surge(1.0 + s.swell) > 0.2, "the surge at the ring: {}", surge(1.0 + s.swell));
        let calm = hour_points(&s, none, none);
        let surged = hour_points(&s, none, |r, _| surge(r));
        for (point, calm) in surged.iter().zip(&calm) {
            let level = (1.3 * ribbon_level(&v, spectrum_at(point.angle, 1.4)) + surge(calm.radius)).min(1.0);
            near(point.radius, at(&s, point.angle, level), &format!("{}", point.angle));
        }
        // The points the front is crossing swing farther; the ones it is far from stay put.
        let swing = |p: &HourPoint| (p.radius - 1.0 - s.swell).abs();
        assert!(surged.iter().zip(&calm).any(|(p, c)| swing(p) > swing(c) + 0.01), "a point the front crosses swings farther");
        for (p, c) in surged.iter().zip(&calm) {
            if surge(c.radius) < 1e-3 {
                near(p.radius, c.radius, &format!("{}, which the front is far from", p.angle));
            }
        }
    }

    #[test]
    fn the_crossing_and_surge_are_asked_in_each_points_direction() {
        let v = values();
        let (crossings, surges) = (std::cell::RefCell::new(Vec::new()), std::cell::RefCell::new(Vec::new()));
        let crossing = |_, theta| {
            crossings.borrow_mut().push(theta);
            0.0
        };
        let surge = |_, theta| {
            surges.borrow_mut().push(theta);
            0.0
        };
        hour_points(&scene(&v), crossing, surge);
        let want: Vec<f64> = (0..12).map(|i| i as f64 * 30.0 * TAU / 360.0).collect();
        assert_eq!(crossings.into_inner(), want);
        assert_eq!(surges.into_inner(), want);
    }

    #[test]
    fn they_stay_visible_in_silence_a_little_dimmer() {
        let v = values();
        let lit = hour_points(&scene(&v), none, none);
        let silent = hour_points(&RingScene { presence: 0.0, ..scene(&v) }, none, none);
        for (p, q) in silent.iter().zip(&lit) {
            assert!(p.glow > 0.3 * q.glow && p.glow < q.glow);
        }
    }
}

mod the_spectrum_level {
    use super::*;

    #[test]
    fn interpolates_the_32_bands_bass_first() {
        let values: Vec<f64> = (0..32).map(|i| i as f64 / 31.0).collect();
        near(spectrum_level(&values, 0.0), 0.0, "");
        near(spectrum_level(&values, 1.0), 1.0, "");
        near(spectrum_level(&values, 0.5), 0.5, "");
    }
}

/// The slope of f at x, from the left and from the right.
fn slopes(f: impl Fn(f64) -> f64, x: f64, h: f64) -> (f64, f64) {
    ((f(x) - f(x - h)) / h, (f(x + h) - f(x)) / h)
}

/// Uneven bands, with peaks and dips next to each other and at both ends.
fn uneven() -> Vec<f64> {
    (0..32).map(|i| [0.9, 0.1, 0.6, 1.0, 0.0, 0.35, 0.8][i % 7]).collect()
}

mod the_smoothed_spectrum {
    use super::*;

    #[test]
    fn passes_through_every_bands_value() {
        let values = uneven();
        for (i, &v) in values.iter().enumerate() {
            near(spectrum_level(&values, i as f64 / 31.0), v, &format!("band {i}:"));
        }
    }

    #[test]
    fn stays_within_0_1_between_the_bands() {
        let values = uneven();
        for s in (0..=3100).map(|i| i as f64 / 3100.0) {
            let level = spectrum_level(&values, s);
            assert!((0.0..=1.0).contains(&level), "{s}: {level}");
        }
    }

    #[test]
    fn has_no_slope_jump_where_one_band_meets_the_next() {
        let values = uneven();
        for i in 1..31 {
            let (left, right) = slopes(|s| spectrum_level(&values, s), i as f64 / 31.0, 1e-7);
            assert!((left - right).abs() < 0.01, "band {i}: {left} vs {right}");
        }
    }
}

// With music the ribbons wave like the bar's, but only outward: each strand rises from the
// swelling dial and back down to it, never inside it, so the clock keeps its room.
mod the_ribbon_with_music {
    use super::*;

    fn playing(level: f64, strand: usize) -> RibbonAt {
        RibbonAt { flow: 1.3, time: 5.0, treble: 0.3, swell: 0.06, level, strand }
    }

    fn span(level: f64, strand: usize) -> (f64, f64) {
        upto(0.0, 360.0, 0.5)
            .map(|angle| ribbon_radius(angle, &playing(level, strand)))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), r| (lo.min(r), hi.max(r)))
    }

    #[test]
    fn swings_only_outward_from_the_swollen_dial_never_inside_it() {
        let base = 1.0 + 0.06;
        for treble in [0.0, 0.5, 1.0] {
            for strand in 0..3 {
                let (mut low, mut high) = (f64::INFINITY, f64::NEG_INFINITY);
                for angle in upto(0.0, 360.0, 0.5) {
                    for time in [5.0, 9.3, 14.1] {
                        let r = ribbon_radius(angle, &RibbonAt { time, treble, ..playing(0.8, strand) });
                        low = low.min(r);
                        high = high.max(r);
                    }
                }
                assert!(low >= base - IDLE_REACH - 1e-12, "strand {strand} treble {treble} inside: {low}");
                assert!(high > base + 2.0 * IDLE_REACH, "strand {strand} treble {treble} outside: {high}");
            }
        }
    }

    #[test]
    fn its_crest_stays_within_the_widgets_room() {
        assert!(RIBBON_REACH * (1.0 + RIBBON_RIPPLE) <= 0.25);
    }

    #[test]
    fn its_slope_is_continuous_across_6_and_12_oclock() {
        let values = uneven();
        for bass_stretch in [1.0, 1.4] {
            for flow in [0.0, 0.7, 2.9] {
                for strand in 0..3 {
                    let at = |angle: f64| {
                        let level = (1.3 * ribbon_level(&values, spectrum_at(angle, bass_stretch))).min(1.0) * 0.7;
                        ribbon_radius(angle, &RibbonAt { flow, ..playing(level, strand) })
                    };
                    for angle in [180.0, 360.0] {
                        let (left, right) = slopes(at, angle, 1e-6);
                        assert!((left - right).abs() < 1e-3, "{angle} strand {strand} flow {flow}: {left} vs {right}");
                    }
                }
            }
        }
    }

    #[test]
    fn treble_never_flattens_a_crest_nor_a_trough() {
        for treble in [0.0, 0.5, 1.0] {
            for strand in 0..3 {
                let at = |angle: f64| ribbon_radius(angle, &RibbonAt { treble, ..playing(1.0, strand) });
                let mut turns = 0;
                for angle in upto(0.0, 360.0, 0.25) {
                    let (r, before, after) = (at(angle), at(angle - 0.25), at(angle + 0.25));
                    // Around 6 and 12 o'clock the halves meet in a rounded turn, left out here.
                    let mirror = angle % 180.0 < 15.0 || angle % 180.0 > 165.0;
                    if !mirror && ((r >= before && r >= after) || (r <= before && r <= after)) {
                        turns += 1;
                        let bend = (r - at(angle - 2.0)).abs().min((r - at(angle + 2.0)).abs());
                        assert!(bend > 1e-4, "treble {treble} strand {strand} flat at {angle}: {bend}");
                    }
                }
                assert!(turns >= 4, "treble {treble} strand {strand}: {turns} turns");
            }
        }
    }

    #[test]
    fn a_louder_level_swings_it_farther_out() {
        for strand in 0..3 {
            assert!(span(0.9, strand).1 > span(0.4, strand).1, "strand {strand}");
        }
    }

    #[test]
    fn its_level_is_the_spectrum_smoothed_gentler_than_the_bands_flat_at_both_ends() {
        let values = uneven();
        let (mut steepest, mut steepest_raw): (f64, f64) = (0.0, 0.0);
        for s in upto(0.01, 0.99, 0.002) {
            steepest = steepest.max(slopes(|x| ribbon_level(&values, x), s, 1e-7).0.abs());
            steepest_raw = steepest_raw.max(slopes(|x| spectrum_level(&values, x), s, 1e-7).0.abs());
        }
        assert!(steepest < steepest_raw / 3.0, "{steepest} vs {steepest_raw}");
        for s in [0.0, 1.0] {
            let (left, right) = slopes(|x| ribbon_level(&values, x), s, 1e-6);
            assert!(left.abs() < 1e-3 && right.abs() < 1e-3, "at {s}: {left}, {right}");
        }
        for s in (0..=100).map(|i| i as f64 / 100.0) {
            let level = ribbon_level(&values, s);
            assert!((0.0..=1.0).contains(&level), "{s}: {level}");
        }
    }
}

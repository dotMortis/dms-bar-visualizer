// Kicks on the Lock Ring: each one sends a chromatic Shockwave out of the center and the hands
// flash. (The sparks it flings off the ring are the shader's alone.) Distances are in dial radii
// (1 = the dial), ages in seconds. Power is the shared detector's hit strength, 0.5 (a soft hit)
// to 1 (the hardest next to the recent kicks). Ported from tests/lock-kicks.test.mjs (v0.10.0).
use std::f64::consts::TAU;

use visualizer_core::lock_ring::*;
use visualizer_core::KICK_SLOTS as KICKS;

/// The default kickDecay (config.json).
const DECAY: f64 = 6.0;

/// One Kick in the first slot, `age` s old at `power`; the other slots empty.
fn one(age: f64, power: f64) -> ([f64; KICKS], [f64; KICKS]) {
    let mut ages = [100.0; KICKS];
    let mut powers = [0.0; KICKS];
    ages[0] = age;
    powers[0] = power;
    (ages, powers)
}

fn crossing(radius: f64, (ages, powers): ([f64; KICKS], [f64; KICKS])) -> f64 {
    shockwave_crossing(radius, &ages, &powers, &[], None)
}

fn surge(radius: f64, (ages, powers): ([f64; KICKS], [f64; KICKS])) -> f64 {
    ribbon_surge(radius, &ages, &powers, &[], None)
}

/// 0, step, 2 step, ... up to `end`.
fn steps(end: f64, step: f64) -> impl Iterator<Item = f64> {
    (0..).map(move |i| i as f64 * step).take_while(move |&x| x <= end + 1e-12)
}

mod shockwave {
    use super::*;

    #[test]
    fn starts_at_the_center() {
        assert_eq!(kick_at(0.0, 1.0).front, KICK_ORIGIN);
        assert_eq!(kick_at(0.0, 0.5).front, KICK_ORIGIN);
    }

    #[test]
    fn expands_outward_as_it_ages() {
        let mut last = -1.0;
        for age in steps(2.0, 0.05) {
            let front = kick_at(age, 0.8).front;
            assert!(front > last, "front {front} at {age} s");
            last = front;
        }
    }

    #[test]
    fn a_harder_hit_makes_a_bigger_shockwave() {
        for age in [0.05, 0.2, 0.5, 1.0, 2.0] {
            assert!(kick_at(age, 1.0).front > kick_at(age, 0.5).front * 1.3, "at {age} s");
        }
        assert!(kick_at(0.1, 1.0).strength > kick_at(0.1, 0.5).strength, "and a brighter one");
    }

    #[test]
    fn the_hardest_hit_passes_the_dial_but_stays_inside_the_widget() {
        let front = kick_at(10.0, 1.0).front;
        assert!(front > 1.1, "front {front}");
        assert!(front < EDGE, "front {front}, edge {EDGE}");
    }

    #[test]
    fn a_soft_hit_still_reaches_past_the_hands() {
        assert!(kick_at(10.0, 0.5).front > 0.6);
    }

    #[test]
    fn fades_out_within_two_seconds() {
        assert!(kick_at(0.0, 1.0).strength >= 0.99);
        assert!(kick_at(2.0, 1.0).strength < 0.02);
    }
}

// The shared pipeline keeps the last 8 kicks; the ring shader draws every one of them, so
// overlapping kicks play together.
mod kick_slots {
    use super::*;

    #[test]
    fn all_8_kicks_reach_the_shader_in_their_slots() {
        let ages = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
        let powers = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 0.55, 0.65];
        let seeds = [9.0, 10.0, 11.0, 12.0, 5.0, 6.0, 7.0, 8.0];
        assert_eq!(kick_slots(&ages, &powers, &seeds), KickSlots { ages, powers, seeds });
    }

    #[test]
    fn before_the_pipeline_runs_every_slot_is_empty() {
        let slots = kick_slots(&[], &[], &[]);
        assert_eq!(slots.powers, [0.0; KICKS], "power 0 = empty slot");
        assert_eq!(slots.seeds, [0.0; KICKS]);
        assert!(slots.ages.iter().all(|&a| a >= 10.0), "and long over");
    }

    #[test]
    fn a_slot_without_a_usable_value_is_empty_not_nan() {
        let slots = kick_slots(&[0.1, f64::NAN], &[1.0, 0.8, 0.9], &[1.0, 2.0, 3.0]);
        assert_eq!(slots.powers[..3], [1.0, 0.0, 0.0]);
        assert!(slots.ages.iter().all(|a| a.is_finite()));
    }

    #[test]
    fn a_kick_that_has_played_out_is_an_empty_slot_so_silence_draws_nothing() {
        let slots = kick_slots(&[2.9, 3.0, 50.0], &[1.0, 1.0, 1.0], &[1.0, 2.0, 3.0]);
        assert_eq!(slots.powers[..3], [1.0, 0.0, 0.0]);
        assert!(kick_at(3.0, 1.0).strength < 0.01, "nothing left to see by then");
    }
}

// One value, 0..1, that all three hands brighten by.
mod hand_flash {
    use super::*;

    fn flash((ages, powers): ([f64; KICKS], [f64; KICKS]), decay: f64) -> f64 {
        hand_flash(&ages, &powers, decay)
    }

    #[test]
    fn is_dark_without_kicks() {
        assert_eq!(hand_flash(&[], &[], DECAY), 0.0);
        assert_eq!(hand_flash(&[100.0; KICKS], &[0.0; KICKS], DECAY), 0.0);
    }

    #[test]
    fn lights_up_the_moment_a_kick_fires_brighter_for_a_harder_hit() {
        assert_eq!(flash(one(0.0, 1.0), DECAY), 1.0);
        assert_eq!(flash(one(0.0, 0.5), DECAY), 0.5);
    }

    #[test]
    fn fires_together_with_the_shockwave_from_the_same_kick() {
        for power in [0.5, 0.75, 1.0] {
            assert!(kick_at(0.0, power).strength > 0.0 && flash(one(0.0, power), DECAY) > 0.0, "power {power}");
        }
    }

    #[test]
    fn is_a_flash_gone_within_0_4_s_at_the_default_kick_decay() {
        assert!(flash(one(0.4, 1.0), DECAY) < 0.1);
    }

    #[test]
    fn a_higher_kick_decay_makes_it_shorter() {
        assert!(flash(one(0.1, 1.0), 12.0) < flash(one(0.1, 1.0), 6.0));
    }

    #[test]
    fn overlapping_kicks_flash_again_and_never_go_past_full() {
        let ages = [0.3, 0.0, 0.05, 100.0, 100.0, 100.0, 100.0, 100.0];
        let powers = [1.0, 0.6, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        let flash = hand_flash(&ages, &powers, DECAY);
        assert!((0.6..=1.0).contains(&flash), "flash {flash}");
    }
}

// How brightly a Shockwave's front is crossing a radius right now, 0..1: what the hour points
// light up by as the wave passes them.
mod shockwave_crossing {
    use super::*;

    #[test]
    fn is_0_with_no_kicks() {
        for r in [0.0, 0.3, 1.0, 1.2] {
            assert_eq!(shockwave_crossing(r, &[], &[], &[], None), 0.0);
            assert_eq!(shockwave_crossing(r, &[100.0; KICKS], &[0.0; KICKS], &[], None), 0.0);
        }
    }

    #[test]
    fn is_0_where_the_front_hasnt_reached_yet_and_peaks_as_the_front_passes() {
        let (mut peak, mut peak_age) = (0.0, 0.0);
        for age in steps(2.0, 0.005) {
            let value = crossing(1.0, one(age, 1.0));
            if kick_at(age, 1.0).front < 0.85 {
                assert_eq!(value, 0.0, "at {age} s, front {}", kick_at(age, 1.0).front);
            }
            if value > peak {
                (peak, peak_age) = (value, age);
            }
        }
        assert!(peak > 0.4, "peak {peak}");
        assert!((kick_at(peak_age, 1.0).front - 1.0).abs() < 0.02, "peaks with the front at {}", kick_at(peak_age, 1.0).front);
    }

    fn peak_at(radius: f64, power: f64) -> f64 {
        steps(3.0, 0.005).map(|t| crossing(radius, one(t, power))).fold(0.0, f64::max)
    }

    #[test]
    fn a_harder_kick_gives_a_higher_peak() {
        for r in [0.3, 0.6] {
            let (soft, hard) = (peak_at(r, 0.5), peak_at(r, 1.0));
            assert!(soft > 0.0, "a soft kick still crosses {r}");
            assert!(hard > soft * 1.3, "at {r}: hard {hard}, soft {soft}");
        }
    }

    #[test]
    fn overlapping_shockwaves_the_brightest_wins_and_it_never_goes_above_1() {
        let ages = [0.3, 0.1, 0.05, 0.0, 0.02, 0.2, 0.15, 0.01];
        let powers = [1.0; KICKS];
        for r in steps(1.4, 0.01) {
            let all = shockwave_crossing(r, &ages, &powers, &[], None);
            let brightest = ages.iter().map(|&age| crossing(r, one(age, 1.0))).fold(0.0, f64::max);
            assert!((all - brightest).abs() < 1e-12, "at {r}: {all} vs {brightest}");
            assert!(all <= 1.0);
        }
    }

    #[test]
    fn reaches_the_digital_time_before_the_ring() {
        // When each radius is crossed hardest by one kick, at every power.
        let peak_age = |radius: f64, power: f64| {
            let (mut peak, mut at) = (0.0, 0.0);
            for age in steps(3.0, 0.002) {
                let value = crossing(radius, one(age, power));
                if value > peak {
                    (peak, at) = (value, age);
                }
            }
            (peak, at)
        };
        assert!(TIME_RADIUS > 0.3 && TIME_RADIUS < 0.8, "the time sits inside the dial, at {TIME_RADIUS}");
        for power in [0.5, 0.75, 1.0] {
            let (peak, at) = peak_age(TIME_RADIUS, power);
            assert!(peak > 0.0, "a {power} kick reaches the time");
            if power == 1.0 {
                let (_, ring) = peak_age(1.0, power);
                assert!(at < ring, "time at {at} s, ring at {ring} s");
            }
        }
    }

    #[test]
    fn fades_as_the_shockwave_fades() {
        // A soft kick's front settles at its reach; a radius there keeps being crossed, fading out.
        let r = kick_at(10.0, 0.5).front;
        let mut last = f64::INFINITY;
        for age in [1.0, 1.5, 2.0, 2.5] {
            let value = crossing(r, one(age, 0.5));
            assert!(value < last, "at {age} s: {value}");
            last = value;
        }
        assert!(last < 0.01, "{last} by 2.5 s");
        assert_eq!(crossing(r, one(3.0, 0.5)), 0.0, "and nothing once it has played out");
    }
}

// How much a Shockwave's front lifts the ribbons where it crosses them (spectrum level, added to
// the music's): the bar's surge, bent into a ring.
mod ribbon_surge {
    use super::*;

    fn peak_at(radius: f64, power: f64) -> f64 {
        steps(3.0, 0.002).map(|t| surge(radius, one(t, power))).fold(0.0, f64::max)
    }

    #[test]
    fn is_0_with_no_kicks() {
        for r in [0.3, 1.0, 1.2] {
            assert_eq!(ribbon_surge(r, &[], &[], &[], None), 0.0);
            assert_eq!(ribbon_surge(r, &[100.0; KICKS], &[0.0; KICKS], &[], None), 0.0);
        }
    }

    #[test]
    fn is_0_before_the_front_arrives_and_after_it_has_passed_and_peaks_as_it_passes() {
        let (mut peak, mut peak_age) = (0.0, 0.0);
        for age in steps(2.0, 0.002) {
            let value = surge(1.0, one(age, 1.0));
            if (kick_at(age, 1.0).front - 1.0).abs() > 0.3 {
                assert!(value < 1e-3, "at {age} s, front {}: {value}", kick_at(age, 1.0).front);
            }
            if value > peak {
                (peak, peak_age) = (value, age);
            }
        }
        assert!(peak > 0.2, "peak {peak}");
        assert!((kick_at(peak_age, 1.0).front - 1.0).abs() < 0.02);
    }

    #[test]
    fn a_harder_kick_surges_more() {
        for r in [0.6, 1.0] {
            let (soft, hard) = (peak_at(r, 0.7), peak_at(r, 1.0));
            assert!(hard > soft * 1.3, "at {r}: hard {hard}, soft {soft}");
        }
    }

    #[test]
    fn overlapping_surges_add_up() {
        let (mut ages, _) = one(0.25, 1.0);
        ages[1] = 0.26;
        let mut powers = [0.0; KICKS];
        powers[..2].copy_from_slice(&[1.0, 1.0]);
        let both = ribbon_surge(1.0, &ages, &powers, &[], None);
        let (first, second) = (surge(1.0, one(0.25, 1.0)), surge(1.0, one(0.26, 1.0)));
        assert!(first > 0.05 && second > 0.05, "{first}, {second}");
        assert!((both - (first + second)).abs() < 1e-12, "{both} vs {first} + {second}");
    }
}

// The center punch: a white-lavender flash at the center as each Shockwave is born, 0..1, from
// that Kick's own power: every Kick punches, a soft one faintly, a hard one strongly.
mod center_punch {
    use super::*;

    fn punch((ages, powers): ([f64; KICKS], [f64; KICKS])) -> f64 {
        center_punch(&ages, &powers)
    }

    #[test]
    fn is_dark_without_kicks() {
        assert_eq!(center_punch(&[], &[]), 0.0);
        assert_eq!(center_punch(&[100.0; KICKS], &[0.0; KICKS]), 0.0);
    }

    #[test]
    fn every_kick_punches_as_its_shockwave_is_born_at_that_kicks_power() {
        assert!((punch(one(0.0, 1.0)) - 1.0).abs() < 1e-9);
        assert!((punch(one(0.0, 0.5)) - 0.5).abs() < 1e-9, "a soft Kick still punches, faintly");
    }

    #[test]
    fn is_a_punch_not_a_glow() {
        assert!(punch(one(0.25, 1.0)) < 0.05, "{}", punch(one(0.25, 1.0)));
        assert!(kick_at(0.25, 1.0).strength > 0.5);
    }

    #[test]
    fn a_new_kick_punches_again_and_overlapping_punches_never_go_past_full() {
        let ages = [0.4, 0.0, 100.0, 100.0, 100.0, 100.0, 100.0, 100.0];
        let powers = [1.0, 0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];
        assert!((center_punch(&ages, &powers) - 0.6).abs() < 0.01);
        assert!(center_punch(&[0.0; KICKS], &[1.0; KICKS]) <= 1.0);
    }
}

// A Kick pushes the Aura outward and eases it back: slow enough to see, as far as the Kick's power.
mod aura_push {
    use super::*;

    fn push((ages, powers): ([f64; KICKS], [f64; KICKS])) -> f64 {
        aura_push(&ages, &powers)
    }

    fn peak(power: f64) -> f64 {
        (0..100).map(|i| push(one(i as f64 / 200.0, power))).fold(f64::NEG_INFINITY, f64::max)
    }

    #[test]
    fn is_still_without_kicks() {
        assert_eq!(aura_push(&[], &[]), 0.0);
        assert_eq!(aura_push(&[100.0; KICKS], &[0.0; KICKS]), 0.0);
    }

    #[test]
    fn eases_out_instead_of_jumping() {
        assert_eq!(push(one(0.0, 1.0)), 0.0);
        assert!(push(one(0.02, 1.0)) < push(one(0.1, 1.0)));
    }

    #[test]
    fn is_a_push_you_can_see() {
        assert!(push(one(0.1, 1.0)) > 0.5, "{}", push(one(0.1, 1.0)));
        assert!(push(one(1.0, 1.0)) < 0.05, "{}", push(one(1.0, 1.0)));
    }

    #[test]
    fn a_soft_kick_pushes_less_and_overlapping_pushes_never_go_past_full() {
        assert!(peak(0.5) < 0.6 * peak(1.0));
        assert!(aura_push(&[0.1; KICKS], &[1.0; KICKS]) <= 1.0);
    }
}

// Each Shockwave has its own shape: not a perfect circle but a soft, wobbly front, brighter on one
// side, different for every Kick (its seed) and the same on every monitor (ADR 0002).
mod shockwave_shape {
    use super::*;

    fn angles(n: usize) -> impl Iterator<Item = f64> {
        (0..n).map(move |i| i as f64 * TAU / n as f64)
    }

    fn front_at(seed: f64, angle: f64, age: f64) -> f64 {
        shockwave_front(age, 1.0, seed, Some(angle)).front
    }

    fn spread(values: impl Iterator<Item = f64>) -> f64 {
        let (lo, hi) = values.fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), v| (lo.min(v), hi.max(v)));
        hi - lo
    }

    #[test]
    fn is_not_a_perfect_circle() {
        let spread = spread(angles(72).map(|a| front_at(7.0, a, 0.4)));
        assert!(spread > 0.03, "spread {spread}");
    }

    #[test]
    fn differs_from_kick_to_kick() {
        let diff = angles(72).map(|a| (front_at(7.0, a, 0.4) - front_at(8.0, a, 0.4)).abs()).fold(0.0, f64::max);
        assert!(diff > 0.02, "largest difference {diff}");
    }

    #[test]
    fn is_born_round_and_only_wobbles_as_it_travels_staying_near_the_round_front() {
        let round = kick_at(0.4, 1.0).front;
        for a in angles(72) {
            assert!((front_at(3.0, a, 0.0) - KICK_ORIGIN).abs() < 1e-9);
            assert!((front_at(3.0, a, 0.4) - round).abs() <= 0.22 * round, "angle {a}");
        }
    }

    #[test]
    fn has_a_ragged_edge() {
        let fine: Vec<f64> = angles(720).map(|a| front_at(7.0, a, 0.4)).collect();
        let n = fine.len();
        let turns = (0..n)
            .filter(|&i| {
                let (prev, next) = (fine[(i + n - 1) % n], fine[(i + 1) % n]);
                (fine[i] - prev) * (next - fine[i]) < 0.0
            })
            .count();
        assert!(turns > 14, "{turns} turns");
    }

    #[test]
    fn flickers_along_its_edge_as_it_travels() {
        let rel = (0..40).map(|i| {
            let t = 0.05 + i as f64 * 0.02;
            shockwave_front(t, 1.0, 5.0, Some(1.1)).strength / kick_at(t, 1.0).strength
        });
        let flicker = spread(rel);
        assert!(flicker > 0.15, "flicker {flicker}");
    }

    #[test]
    fn is_calmer_on_a_soft_kick_than_on_a_hard_one() {
        let stray = |power: f64| {
            let round = kick_at(0.4, power).front - KICK_ORIGIN;
            angles(72)
                .map(|a| (shockwave_front(0.4, power, 7.0, Some(a)).front - KICK_ORIGIN - round).abs() / round)
                .fold(0.0, f64::max)
        };
        assert!(stray(0.5) < 0.4 * stray(1.0), "soft {}, hard {}", stray(0.5), stray(1.0));
    }

    #[test]
    fn is_brighter_on_one_side_but_never_past_the_round_waves_strength_by_much() {
        let s: Vec<f64> = angles(72).map(|a| shockwave_front(0.2, 1.0, 5.0, Some(a)).strength).collect();
        assert!(spread(s.iter().copied()) > 0.2);
        assert!(s.iter().copied().fold(0.0, f64::max) <= 1.35 * kick_at(0.2, 1.0).strength);
    }

    #[test]
    fn the_crossing_and_surge_follow_the_shaped_front_in_a_direction() {
        let (angle, seed, age) = (1.3, [11.0], [0.4]);
        let front = shockwave_front(age[0], 1.0, seed[0], Some(angle)).front;
        let crossing = |r: f64| shockwave_crossing(r, &age, &[1.0], &seed, Some(angle));
        let surge = |r: f64| ribbon_surge(r, &age, &[1.0], &seed, Some(angle));
        assert!(crossing(front) > crossing(front + 0.12));
        assert!(surge(front) > 2.0 * surge(front + 0.15));
        assert!(crossing(front) <= 1.0);
    }

    #[test]
    fn without_a_direction_the_shockwave_is_the_round_one() {
        assert_eq!(shockwave_crossing(0.6, &[0.3], &[1.0], &[9.0], None), shockwave_crossing(0.6, &[0.3], &[1.0], &[], None));
        assert_eq!(shockwave_front(0.3, 1.0, 9.0, None), kick_at(0.3, 1.0));
    }
}

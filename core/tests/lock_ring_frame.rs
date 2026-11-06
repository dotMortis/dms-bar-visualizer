// The Visualizer configured as the Lock Ring: its state as lock_ring() gives it, frame by frame:
// the ring's motion, the Hands (always on the true time), the Hour Points, the Digital Time's hit
// and the shader's Kick slots. The ring and hand motion tests are ported from
// tests/lock-ring.test.mjs and tests/lock-hands.test.mjs (v0.10.0), driven through the Visualizer.
mod common;

use std::f64::consts::PI;

use common::*;
use visualizer_core::lock_ring::*;
use visualizer_core::{Kind, LockRingFrame, Player, Visualizer, BANDS};

fn lock_ring(settings: &str) -> Visualizer {
    let mut visualizer = Visualizer::new();
    visualizer.set_kind(Kind::LockRing);
    visualizer.configure(settings);
    visualizer.set_player(Player::Playing);
    visualizer
}

/// One capture frame whose bass, mid and treble are `levels`.
fn bands([bass, mid, treble]: [f64; 3]) -> [f64; BANDS] {
    std::array::from_fn(|i| {
        if i < 6 {
            bass
        } else if i < 16 {
            mid
        } else {
            treble
        }
    })
}

/// `levels` for `seconds` at 60 fps, a capture frame and a display frame each; the Lock Ring's
/// state after the last.
fn play(visualizer: &mut Visualizer, clock: &mut f64, levels: [f64; 3], seconds: f64) -> LockRingFrame {
    let values = bands(levels);
    for _ in 0..(seconds * 60.0).round() as usize {
        *clock += 1.0 / 60.0;
        visualizer.push_bands(&values, *clock);
        visualizer.advance(1.0 / 60.0);
    }
    visualizer.lock_ring()
}

const SILENCE: [f64; 3] = [0.0; 3];
const MUSIC: [f64; 3] = [0.6, 0.4, 0.3];

mod ring_motion {
    use super::*;

    fn fresh(levels: [f64; 3], seconds: f64) -> LockRingFrame {
        play(&mut lock_ring("{}"), &mut 0.0, levels, seconds)
    }

    #[test]
    fn in_silence_the_ribbon_idles_no_music_in_it_no_swell() {
        let ring = fresh(SILENCE, 1.0);
        assert_eq!((ring.swell, ring.presence), (0.0, 0.0));
    }

    #[test]
    fn when_the_music_starts_the_ribbons_show_within_a_quarter_second_and_the_ring_swells() {
        let ring = fresh(MUSIC, 0.25);
        assert!(ring.presence > 0.9, "presence {}", ring.presence);
        assert!(ring.swell > 0.0, "swell {}", ring.swell);
    }

    #[test]
    fn louder_music_swells_the_ring_more() {
        let quiet = fresh([0.2, 0.1, 0.1], 0.5).swell;
        let loud = fresh([0.9, 0.6, 0.4], 0.5).swell;
        assert!(loud > quiet * 2.0, "loud {loud}, quiet {quiet}");
    }

    #[test]
    fn the_swell_follows_a_beat_up_on_the_hit_and_back_down_before_the_next_one() {
        let (mut v, mut clock) = (lock_ring("{}"), 0.0);
        let calm = [0.1, 0.1, 0.1];
        play(&mut v, &mut clock, calm, 1.0);
        let before = play(&mut v, &mut clock, calm, 1.0 / 60.0).swell;
        let hit = play(&mut v, &mut clock, [1.0, 0.4, 0.2], 0.1).swell;
        let after = play(&mut v, &mut clock, calm, 0.4).swell;
        assert!(hit > before * 3.0, "hit {hit}, before {before}");
        assert!(after < before * 1.2, "after {after}, before {before}");
    }

    #[test]
    fn at_full_scale_the_ring_swells_by_at_most_a_tenth_of_the_dial() {
        let swell = fresh([1.0; 3], 2.0).swell;
        assert!(swell > 0.05 && swell <= 0.1, "swell {swell}");
    }

    #[test]
    fn when_the_music_stops_the_ribbon_is_back_to_idling_within_1_5_s() {
        let (mut v, mut clock) = (lock_ring("{}"), 0.0);
        play(&mut v, &mut clock, MUSIC, 3.0);
        let ring = play(&mut v, &mut clock, SILENCE, 1.5);
        assert!(ring.presence < 0.02, "presence {}", ring.presence);
        assert!(ring.swell < 0.002, "swell {}", ring.swell);
    }

    #[test]
    fn the_ring_moves_at_display_time_whatever_the_speed() {
        let at = |speed: &str| play(&mut lock_ring(speed), &mut 0.0, MUSIC, 0.1);
        let (normal, fast) = (at("{}"), at(r#"{"speed": 3}"#));
        assert_eq!((normal.swell, normal.presence), (fast.swell, fast.presence));
    }
}

// Each hand shows its own band, measured against its own recent peak, and runs its wave at its own
// band's pace.
mod hand_motion {
    use super::*;

    #[test]
    fn quiet_highs_move_the_second_hand_as_much_as_loud_bass_moves_the_hour_hand() {
        let (mut v, mut clock) = (lock_ring("{}"), 0.0);
        play(&mut v, &mut clock, [0.4, 0.15, 0.06], 1.0);
        let [bass, mid, treble] = play(&mut v, &mut clock, [0.3, 0.11, 0.045], 0.1).hand_levels;
        assert!((treble - bass).abs() < 0.05, "bass {bass}, treble {treble}");
        assert!((mid - bass).abs() < 0.05, "bass {bass}, mid {mid}");
    }

    #[test]
    fn each_band_only_moves_its_own_hand() {
        let (mut v, mut clock) = (lock_ring("{}"), 0.0);
        play(&mut v, &mut clock, [0.4, 0.15, 0.06], 1.0);
        // Let the Kicks play out first: their flash swings every hand a little.
        let ring = play(&mut v, &mut clock, [0.4, 0.0, 0.0], 3.0);
        assert_eq!(ring.hand_flash, 0.0);
        assert_eq!(ring.hand_levels[1..], [0.0, 0.0]);
        assert_eq!(ring.hand_amplitudes[1..], [0.0, 0.0]);
        assert!(ring.hand_amplitudes[0] > 0.0);
    }

    #[test]
    fn a_near_silent_band_stays_near_silent_instead_of_being_scaled_up_to_full() {
        let treble = play(&mut lock_ring("{}"), &mut 0.0, [0.0, 0.0, LEVEL_FLOOR / 4.0], 2.0).hand_levels[2];
        assert!(treble <= 0.25, "treble {treble}");
    }

    #[test]
    fn after_a_loud_stretch_a_quieter_one_grows_back_to_full_as_the_peak_fades() {
        let (mut v, mut clock) = (lock_ring("{}"), 0.0);
        play(&mut v, &mut clock, [0.8, 0.0, 0.0], 1.0);
        let soon = play(&mut v, &mut clock, [0.4, 0.0, 0.0], 0.1).hand_levels[0];
        let later = play(&mut v, &mut clock, [0.4, 0.0, 0.0], LEVEL_HALF_LIFE * 2.0).hand_levels[0];
        assert!(soon < 0.6, "right after: {soon}");
        assert_eq!(later, 1.0);
    }

    #[test]
    fn a_hands_wave_travels_faster_the_louder_its_band_and_with_the_speed_setting() {
        let phases = |speed: &str| play(&mut lock_ring(speed), &mut 0.0, [0.4, 0.0, 0.0], 1.0).hand_phases;
        let [hour, minute, second] = phases("{}");
        assert!(hour > minute * 1.5, "hour {hour}, minute {minute}");
        assert_eq!(minute, second, "both silent: the same calm pace");
        assert!(phases(r#"{"speed": 2}"#)[0] > hour * 1.9);
    }

    #[test]
    fn the_phases_stay_within_their_wrap() {
        let ring = play(&mut lock_ring("{}"), &mut 0.0, [1.0; 3], 30.0);
        for p in ring.hand_phases {
            assert!((0.0..PHASE_WRAP).contains(&p), "phase {p}");
        }
    }
}

// The Hands swing with the music, but always point at the true time.
mod the_hands_show_the_true_time {
    use super::*;

    #[test]
    fn at_3_00_00_through_a_whole_track_the_hour_hand_points_at_3_and_the_others_at_12() {
        let mut v = lock_ring("{}");
        v.set_local_time(3.0 * 3600.0);
        let mut swung = false;
        for f in &fixture("zoo1").frames {
            v.push_bands(&f.values, f.time);
            v.advance(1.0 / 60.0);
            let ring = v.lock_ring();
            assert_eq!(ring.hand_angles, [90.0 * PI / 180.0, 0.0, 0.0], "at {} s", f.time);
            swung |= ring.hand_amplitudes.iter().all(|&a| a > 0.0) && ring.hand_flash > 0.5;
        }
        assert!(swung, "the music swung the hands");
    }

    #[test]
    fn as_the_time_runs_on_the_hands_follow_it_on_every_frame() {
        for scenario in ["dnb_808", "loud_quiet", "tones"] {
            let mut v = lock_ring(r#"{"lockRing": {"handWaves": 2}}"#);
            // From 23:59:50, past midnight.
            let start = 86390.0;
            for (n, f) in fixture(scenario).frames.iter().enumerate() {
                let time = start + n as f64 / 60.0;
                v.set_local_time(time);
                v.push_bands(&f.values, f.time);
                v.advance(1.0 / 60.0);
                let want = hand_angles(time).map(|a| a * PI / 180.0);
                assert_eq!(v.lock_ring().hand_angles, want, "{scenario} frame {n}");
            }
        }
    }

    #[test]
    fn a_time_that_isnt_one_is_ignored() {
        let mut v = lock_ring("{}");
        v.set_local_time(9.0 * 3600.0);
        for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
            v.set_local_time(bad);
            assert_eq!(v.lock_ring().hand_angles, [270.0 * PI / 180.0, 0.0, 0.0]);
        }
    }
}

#[test]
fn the_hands_look_follows_their_motion_the_kick_flash_and_hand_waves() {
    let (mut v, mut clock) = (lock_ring(r#"{"lockRing": {"handWaves": 1.5}}"#), 0.0);
    v.set_local_time(10.0 * 3600.0 + 600.0);
    let mut seen_flash = false;
    for (n, f) in fixture("steady_house").frames.iter().enumerate().take(600) {
        clock = f.time;
        v.push_bands(&f.values, f.time);
        v.advance(1.0 / 60.0);
        let ring = v.lock_ring();
        let poses = hand_poses(10.0 * 3600.0 + 600.0, ring.hand_levels, ring.hand_flash, 1.5);
        for (i, p) in poses.iter().enumerate() {
            let got = [
                ring.hand_inner[i],
                ring.hand_lengths[i],
                ring.hand_amplitudes[i],
                ring.hand_widths[i],
                ring.hand_glows[i],
            ];
            assert_eq!(got, [p.inner, p.length, p.amplitude, p.width, p.glow], "frame {n} hand {i}");
        }
        let frame = v.frame();
        assert_eq!(ring.hand_flash, hand_flash(&frame.kick_ages, &frame.kick_powers, 6.0));
        seen_flash |= ring.hand_flash > 0.9;
    }
    assert!(seen_flash, "a Kick flashed the hands");
    // With handWaves 0 the hands stay straight.
    let mut v = lock_ring(r#"{"lockRing": {"handWaves": 0}}"#);
    let ring = play(&mut v, &mut clock, MUSIC, 1.0);
    assert_eq!(ring.hand_amplitudes, [0.0; 3]);
}

#[test]
fn the_shaders_kick_slots_are_the_live_kicks_and_played_out_ones_are_empty() {
    let mut v = lock_ring("{}");
    let (mut live, mut played_out) = (false, false);
    for f in &fixture("loud_quiet").frames {
        v.push_bands(&f.values, f.time);
        v.advance(1.0 / 60.0);
        let (frame, ring) = (v.frame(), v.lock_ring());
        for i in 0..8 {
            let (age, power) = (frame.kick_ages[i], frame.kick_powers[i]);
            if power > 0.0 && age < 3.0 {
                live = true;
                assert_eq!(
                    (ring.kick_ages[i], ring.kick_powers[i], ring.kick_seeds[i]),
                    (age, power, frame.kick_seeds[i])
                );
            } else {
                played_out |= power > 0.0;
                assert_eq!((ring.kick_ages[i], ring.kick_powers[i], ring.kick_seeds[i]), (100.0, 0.0, 0.0));
            }
        }
    }
    assert!(live && played_out);
}

#[test]
fn the_digital_time_flares_and_splits_as_a_shockwave_crosses_it() {
    let mut v = lock_ring("{}");
    let (mut peak, mut at_rest) = (0.0f64, false);
    for f in &fixture("kick_only").frames {
        v.push_bands(&f.values, f.time);
        v.advance(1.0 / 60.0);
        let (frame, ring) = (v.frame(), v.lock_ring());
        let crossing =
            shockwave_crossing(TIME_RADIUS, &frame.kick_ages, &frame.kick_powers, &frame.kick_seeds, Some(PI));
        assert_eq!(ring.time_crossing, crossing);
        assert_eq!(ring.time_hit, time_hit(crossing));
        peak = peak.max(ring.time_hit.white);
        at_rest |= ring.time_hit.white == 0.0 && frame.kick_count > 0;
    }
    assert!(peak > 0.3, "the time flared: {peak}");
    assert!(at_rest, "and settled between the Kicks");
}

#[test]
fn the_hour_points_ride_the_ribbon_and_flash_as_each_kicks_shaped_front_reaches_them() {
    let mut v = lock_ring(r#"{"bassStretch": 1.7}"#);
    let mut flashed = 0;
    let calm = 0.6 * (0.6 + 0.4 * 1.0);
    for f in fixture("dnb_808").frames.iter().take(900) {
        v.push_bands(&f.values, f.time);
        v.advance(1.0 / 60.0);
        let (frame, ring) = (v.frame(), v.lock_ring());
        let (ages, powers, seeds) = (&frame.kick_ages, &frame.kick_powers, &frame.kick_seeds);
        let scene = RingScene {
            values: &frame.bands,
            flow: frame.flow,
            time: frame.time,
            treble: frame.treble,
            swell: ring.swell,
            presence: ring.presence,
            bass_stretch: 1.7,
        };
        let points = hour_points(
            &scene,
            |r, theta| shockwave_crossing(r, ages, powers, seeds, Some(theta)),
            |r, theta| ribbon_surge(r, ages, powers, seeds, Some(theta)),
        );
        assert_eq!(ring.hour_radii, points.map(|p| p.radius));
        assert_eq!(ring.hour_glows, points.map(|p| p.glow));
        flashed += ring.hour_glows.iter().filter(|&&g| g > calm + 0.3).count();
    }
    assert!(flashed > 0, "the Shockwaves flashed the Hour Points");
}

// In Silence the Lock Ring may stop drawing once nothing moves without sound: as the bar, and once
// its ring has settled too (lock-ring/pace.mjs atRest()).
#[test]
fn it_keeps_animating_until_the_ring_has_settled() {
    let (mut v, mut clock) = (lock_ring(r#"{"kickThreshold": 100}"#), 0.0);
    let mut bar = Visualizer::new();
    bar.configure(r#"{"kickThreshold": 100}"#);
    bar.set_player(Player::Playing);
    let mut bar_clock = 0.0;
    play(&mut v, &mut clock, MUSIC, 2.0);
    play(&mut bar, &mut bar_clock, MUSIC, 2.0);
    let mut settled_at = None;
    for n in 0..240 {
        let ring = play(&mut v, &mut clock, SILENCE, 1.0 / 60.0);
        play(&mut bar, &mut bar_clock, SILENCE, 1.0 / 60.0);
        assert!(!bar.frame().animating, "no Kicks: the bar has nothing to animate");
        let moving = ring.presence >= AT_REST || ring.swell >= AT_REST;
        assert_eq!(v.frame().animating, moving, "frame {n}");
        if !moving && settled_at.is_none() {
            settled_at = Some(n);
        }
    }
    let settled_at = settled_at.expect("the ring settles");
    assert!(settled_at > 30, "the ribbons fade out over a while: {settled_at}");
}

#[test]
fn the_bar_kind_keeps_no_lock_ring_state() {
    let mut v = Visualizer::new();
    v.set_player(Player::Playing);
    v.set_local_time(3.0 * 3600.0);
    let before = v.lock_ring();
    play(&mut v, &mut 0.0, MUSIC, 1.0);
    assert_eq!(v.lock_ring(), before);
}

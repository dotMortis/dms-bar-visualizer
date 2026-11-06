// The rest of what the Bar Visualizer's shader draws from (shaders/viz.frag), as v0.10.0's
// audio/AudioPipeline.qml and shell.qml computed it: the animation clock, the wave phase (flow),
// the Kick slots and the settings it takes as they are.
mod common;

use common::*;
use visualizer_core::{Visualizer, BANDS, KICK_SLOTS};

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn time_runs_at_speed_with_the_display_frames() {
    let mut visualizer = Visualizer::new();
    assert_eq!(visualizer.frame().time, 0.0);
    for _ in 0..60 {
        visualizer.advance(1.0 / 60.0);
    }
    assert!(close(visualizer.frame().time, 1.0), "{}", visualizer.frame().time);

    let mut visualizer = Visualizer::new();
    visualizer.configure(r#"{"speed": 2.5}"#);
    visualizer.advance(0.5);
    assert!(close(visualizer.frame().time, 1.25), "{}", visualizer.frame().time);
}

#[test]
fn time_wraps_at_1200_seconds_as_the_shader_gets_it() {
    // shell.qml hands viz.frag `audio.time % 1200`, so its 32-bit floats keep their precision.
    let mut visualizer = Visualizer::new();
    for _ in 0..1201 {
        visualizer.advance(1.0);
    }
    assert!(close(visualizer.frame().time, 1.0), "{}", visualizer.frame().time);
}

/// A Visualizer on these settings (JSON members) that never fires a Kick.
fn no_kicks(settings: &str) -> Visualizer {
    let mut visualizer = Visualizer::new();
    let sep = if settings.is_empty() { "" } else { ", " };
    visualizer.configure(&format!(r#"{{"kickThreshold": 1e9{sep}{settings}}}"#));
    visualizer
}

#[test]
fn flow_runs_with_the_bass_and_mid() {
    // Half-level bands: bass and mid 0.5, so the wave moves 8 * 0.5 + 4 * 0.5 = 6 a second.
    let mut visualizer = no_kicks("");
    visualizer.push_bands(&[0.5; BANDS], 0.0);
    for _ in 0..60 {
        visualizer.advance(1.0 / 60.0);
    }
    assert!(close(visualizer.frame().flow, 6.0), "{}", visualizer.frame().flow);
    // Twice as fast at speed 2; not at all with no bands.
    let mut visualizer = no_kicks(r#""speed": 2"#);
    visualizer.push_bands(&[0.5; BANDS], 0.0);
    visualizer.advance(0.5);
    assert!(close(visualizer.frame().flow, 6.0), "{}", visualizer.frame().flow);
    let mut visualizer = Visualizer::new();
    visualizer.advance(1.0);
    assert_eq!(visualizer.frame().flow, 0.0);
}

/// A Visualizer fed kick_only up to its first Kick.
fn at_first_kick() -> Visualizer {
    let mut visualizer = Visualizer::new();
    for f in &fixture("kick_only").frames {
        visualizer.push_bands(&f.values, f.time);
        if visualizer.frame().kick_count == 1 {
            return visualizer;
        }
        visualizer.advance(1.0 / 60.0);
    }
    panic!("no Kick in kick_only");
}

#[test]
fn a_kick_pushes_the_wave_on_by_6_times_its_level_before_it_fades() {
    let mut visualizer = at_first_kick();
    let frame = visualizer.frame();
    visualizer.advance(0.01);
    let moved = visualizer.frame().flow - frame.flow;
    assert!(close(moved, 0.01 * (8.0 * frame.bass + 4.0 * frame.mid + 6.0)), "{moved}");
}

#[test]
fn flow_wraps_at_40_pi_where_every_ribbon_repeats() {
    // Full bands: 12 a second, so 11 s is 132, once round 40π.
    let mut visualizer = no_kicks("");
    visualizer.push_bands(&[1.0; BANDS], 0.0);
    for _ in 0..11 {
        visualizer.advance(1.0);
    }
    assert!(close(visualizer.frame().flow, 132.0 - 125.663_706_143_591_72), "{}", visualizer.frame().flow);
}

// The Kick slots: the last KICK_SLOTS Kicks, so a new Kick's Shockwave and Spray add to the ones
// still playing. A ring buffer: Kick n (counted 1..999, 0, 1, ...) goes in slot n % 8 with its
// age on the animation clock, its power and n as its seed.

#[test]
fn before_any_kick_every_slot_is_empty() {
    let mut visualizer = Visualizer::new();
    visualizer.advance(2.0);
    let frame = visualizer.frame();
    assert_eq!(frame.kick_powers, [0.0; KICK_SLOTS]);
    assert_eq!(frame.kick_seeds, [0.0; KICK_SLOTS]);
    // An empty slot's Kick was 100 s before the clock started.
    assert_eq!(frame.kick_ages, [102.0; KICK_SLOTS]);
}

#[test]
fn a_kick_lands_in_its_slot_and_ages_on_the_animation_clock() {
    let mut visualizer = at_first_kick();
    let frame = visualizer.frame();
    assert_eq!(frame.kick_ages[1], 0.0);
    assert_eq!(frame.kick_powers[1], frame.kick_power);
    assert_eq!(frame.kick_seeds[1], 1.0);
    for slot in [0, 2, 3, 4, 5, 6, 7] {
        assert_eq!(frame.kick_powers[slot], 0.0, "slot {slot}");
        assert!(close(frame.kick_ages[slot], frame.time + 100.0), "slot {slot}");
    }
    visualizer.advance(0.25);
    assert!(close(visualizer.frame().kick_ages[1], 0.25));
    visualizer.configure(r#"{"speed": 2}"#);
    visualizer.advance(0.25);
    assert!(close(visualizer.frame().kick_ages[1], 0.75));
}

#[test]
fn each_kick_overwrites_the_oldest_slot_and_seeds_count_to_999_and_round() {
    // kick_only, over and over: its 44 Kicks 23 times is past 1000.
    let frames = &fixture("kick_only").frames;
    let length = frames.last().unwrap().time + 1.0;
    let mut visualizer = Visualizer::new();
    let mut kicks = 0u32;
    for pass in 0..23 {
        for f in frames {
            let count = visualizer.frame().kick_count;
            visualizer.push_bands(&f.values, f.time + pass as f64 * length);
            let frame = visualizer.frame();
            if frame.kick_count != count {
                kicks += 1;
                let seed = kicks % 1000;
                let slot = (seed % 8) as usize;
                assert_eq!(frame.kick_seeds[slot], seed as f64, "Kick {kicks}");
                assert_eq!(frame.kick_powers[slot], frame.kick_power, "Kick {kicks}");
                assert_eq!(frame.kick_ages[slot], 0.0, "Kick {kicks}");
                // The others are older.
                assert!(frame.kick_ages.iter().enumerate().all(|(i, &age)| i == slot || age > 0.0), "Kick {kicks}");
            }
            visualizer.advance(1.0 / 60.0);
        }
    }
    assert!(kicks > 1000, "{kicks} Kicks");
}

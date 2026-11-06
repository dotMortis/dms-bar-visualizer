// What frame() gives the shaders besides the Kicks: the bands, their bass/mid/treble averages, and
// the Kick level, 1 when a Kick fires and fading at kickDecay per second as display frames pass
// (audio/AudioPipeline.qml in v0.10.0).
mod common;

use common::*;
use visualizer_core::{Visualizer, BANDS};

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-12
}

#[test]
fn bass_mid_and_treble_average_the_bands_below_6_below_16_and_the_rest() {
    let mut bands = [0.125; BANDS];
    bands[..6].fill(0.5);
    bands[6..16].fill(0.25);
    bands[0] = 0.8; // bass: (0.8 + 5 * 0.5) / 6 = 0.55
    let mut visualizer = Visualizer::new();
    visualizer.push_bands(&bands, 1.0);
    let frame = visualizer.frame();
    assert_eq!(frame.bands, bands);
    assert!(close(frame.bass, 0.55), "bass {}", frame.bass);
    assert!(close(frame.mid, 0.25), "mid {}", frame.mid);
    assert!(close(frame.treble, 0.125), "treble {}", frame.treble);
}

/// A Visualizer on these settings, fed kick_only up to its first Kick.
fn at_first_kick(settings: &str) -> Visualizer {
    let mut visualizer = Visualizer::new();
    visualizer.configure(settings);
    for f in &fixture("kick_only").frames {
        visualizer.push_bands(&f.values, f.time);
        if visualizer.frame().kick_count == 1 {
            return visualizer;
        }
    }
    panic!("no Kick in kick_only");
}

#[test]
fn the_kick_level_is_0_until_a_kick_and_1_when_one_fires() {
    let mut visualizer = Visualizer::new();
    visualizer.push_bands(&[0.0; BANDS], 0.0);
    assert_eq!(visualizer.frame().kick, 0.0);
    assert_eq!(at_first_kick("{}").frame().kick, 1.0);
}

#[test]
fn the_kick_level_fades_at_kick_decay_per_second_of_display_frames() {
    // At the default kickDecay of 6, a tenth of a second leaves e^-0.6 of it.
    let mut visualizer = at_first_kick("{}");
    visualizer.advance(0.1);
    assert!(close(visualizer.frame().kick, 0.548_811_636_094_026_4), "{}", visualizer.frame().kick);
    // At kickDecay 2, half a second leaves e^-1, however it's split into frames.
    let mut visualizer = at_first_kick(r#"{"kickDecay": 2}"#);
    for _ in 0..5 {
        visualizer.advance(0.1);
    }
    assert!(close(visualizer.frame().kick, 0.367_879_441_171_442_3), "{}", visualizer.frame().kick);
}

#[test]
fn a_new_kick_sets_the_level_back_to_1() {
    let mut visualizer = Visualizer::new();
    let mut levels = Vec::new();
    for f in &fixture("kick_only").frames {
        let count = visualizer.frame().kick_count;
        visualizer.push_bands(&f.values, f.time);
        if visualizer.frame().kick_count != count {
            levels.push(visualizer.frame().kick);
        }
        visualizer.advance(1.0 / 60.0);
    }
    assert_eq!(levels.len(), 44);
    assert!(levels.iter().all(|&l| l == 1.0), "{levels:?}");
}

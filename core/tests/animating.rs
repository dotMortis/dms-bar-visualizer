// Whether anything is still animating, so a visualizer in Silence knows when it may stop drawing
// (#55): a Kick's Shockwave until it has played out (PLAYED_OUT s on the animation clock), and the
// Kick level until it has faded below KICK_SETTLED.
mod common;

use common::*;
use visualizer_core::{Visualizer, BANDS, KICK_SETTLED, PLAYED_OUT};

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

/// Display frames at 60 fps for `seconds`.
fn run(visualizer: &mut Visualizer, seconds: f64) {
    for _ in 0..(seconds * 60.0).round() as usize {
        visualizer.advance(1.0 / 60.0);
    }
}

#[test]
fn nothing_animates_before_any_kick() {
    let mut visualizer = Visualizer::new();
    visualizer.configure(r#"{"kickThreshold": 1e9}"#);
    assert!(!visualizer.frame().animating);
    visualizer.push_bands(&[0.3; BANDS], 0.0);
    visualizer.advance(1.0);
    assert!(!visualizer.frame().animating);
}

#[test]
fn a_kick_animates_until_its_shockwave_has_played_out() {
    assert_eq!(PLAYED_OUT, 3.0);
    let mut visualizer = at_first_kick("{}");
    assert!(visualizer.frame().animating);
    run(&mut visualizer, 2.9);
    // The Kick level faded long ago at kickDecay 6 (e^-17), but the Shockwave flies on.
    assert!(visualizer.frame().kick < KICK_SETTLED);
    assert!(visualizer.frame().animating);
    run(&mut visualizer, 0.2);
    assert!(!visualizer.frame().animating);
}

#[test]
fn a_slow_kick_decay_animates_until_the_kick_level_has_settled() {
    // At kickDecay 0.5 the level takes ln(1000) / 0.5 = 13.8 s to fall below 0.001.
    assert_eq!(KICK_SETTLED, 0.001);
    let mut visualizer = at_first_kick(r#"{"kickDecay": 0.5}"#);
    run(&mut visualizer, 13.7);
    assert!(visualizer.frame().animating);
    run(&mut visualizer, 0.2);
    assert!(!visualizer.frame().animating);
}

#[test]
fn at_speed_0_a_shockwave_stands_still_so_only_the_kick_level_animates() {
    let mut visualizer = at_first_kick(r#"{"speed": 0}"#);
    run(&mut visualizer, 2.0);
    assert_eq!(visualizer.frame().kick_ages.iter().copied().fold(f64::MAX, f64::min), 0.0);
    assert!(!visualizer.frame().animating);
}

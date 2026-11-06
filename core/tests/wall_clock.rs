// Each capture frame comes stamped with the wall clock when it arrived, which can step back (an NTP
// correction, the time set by hand). A step back counts as no time passing. Ported from
// tests/clock.test.mjs (v0.10.0).
mod common;

use common::*;
use visualizer_core::{Visualizer, BANDS};

const FPS: f64 = 60.0;

/// Two seconds at 60 fps: silence, and a hit in band 2 at 1 s and again at 1.5 s, each dying down
/// within 0.1 s. Both land in the same band, so the second one only fires once the first has ended.
fn hits() -> Vec<[f64; BANDS]> {
    (0..2 * FPS as usize)
        .map(|n| {
            let mut values = [0.0; BANDS];
            for at in [1.0, 1.5] {
                if n as f64 >= at * FPS {
                    values[2] = 0.8 * (-(n as f64 / FPS - at) / 0.04).exp();
                }
            }
            values
        })
        .collect()
}

/// The frames at which Kicks fire, with frame n stamped clock(n) seconds.
fn kicks_on(clock: impl Fn(usize) -> f64, settings: &str) -> Vec<usize> {
    let mut visualizer = Visualizer::new();
    visualizer.configure(settings);
    let mut fired = Vec::new();
    for (n, values) in hits().iter().enumerate() {
        let count = visualizer.frame().kick_count;
        visualizer.push_bands(values, clock(n));
        if visualizer.frame().kick_count != count {
            fired.push(n);
        }
    }
    fired
}

#[test]
fn a_clock_stepping_back_fires_the_kicks_of_one_standing_still_for_a_frame() {
    // At 1.1 s, while the first hit dies down.
    let step = (1.1 * FPS) as usize;
    for (config, settings) in CONFIGS {
        let settings = settings.json();
        let still = |n: usize| (if n < step { n } else { n - 1 }) as f64 / FPS;
        assert_eq!(kicks_on(still, &settings), [60, 90], "at {config}");
        for back in [1.0, 3600.0] {
            let stepped = |n: usize| n as f64 / FPS - if n < step { 0.0 } else { back };
            assert_eq!(
                kicks_on(stepped, &settings),
                kicks_on(still, &settings),
                "at {config}, stepping back by {back} s"
            );
        }
    }
}

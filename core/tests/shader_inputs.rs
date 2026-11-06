// The rest of what the Bar Visualizer's shader draws from (shaders/viz.frag), as v0.10.0's
// audio/AudioPipeline.qml and shell.qml computed it: the animation clock, the wave phase (flow),
// the Kick slots and the settings it takes as they are.
mod common;

use common::*;
use visualizer_core::{Visualizer, BANDS};

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

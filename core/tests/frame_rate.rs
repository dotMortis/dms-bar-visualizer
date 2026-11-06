// The visualizer gets cava's 60 frames per second, the demo pushes one frame per display refresh.
// Replays every fixture with its frames repeated the way a faster display shows them, and holds the
// Visualizer to the Kicks it fires at 60 fps. Ported from tests/frame-rate.test.mjs.
mod common;

use common::*;

/// One cava frame: the fixtures' frames are 16.4 to 16.9 ms apart.
const FRAME: f64 = 0.017;

/// The Kicks with no Kick of the other list within a frame.
fn unmatched(kicks: &[f64], others: &[f64]) -> Vec<f64> {
    kicks.iter().copied().filter(|t| !others.iter().any(|o| (o - t).abs() <= FRAME)).collect()
}

fn fires_the_kicks_it_fires_at_60_fps(fps: f64) {
    for (config, settings) in CONFIGS {
        for scenario in scenarios() {
            let frames = &fixture(scenario).frames;
            let at60 = times(&replay(frames, settings));
            let at_fps = times(&replay(&at_frame_rate(frames, fps), settings));
            let (missing, extra) = (unmatched(&at60, &at_fps), unmatched(&at_fps, &at60));
            assert!(missing.is_empty(), "{scenario} at {config}: Kicks at 60 fps that don't fire at {fps} Hz: {missing:?}");
            assert!(extra.is_empty(), "{scenario} at {config}: Kicks only at {fps} Hz: {extra:?}");
            assert_eq!(at_fps.len(), at60.len(), "{scenario} at {config}: Kicks at 60 fps fire more than once");
        }
    }
}

#[test]
fn at_120_hz_every_track_fires_the_kicks_it_fires_at_60_fps_within_a_frame() {
    fires_the_kicks_it_fires_at_60_fps(120.0);
}

#[test]
fn at_144_hz_every_track_fires_the_kicks_it_fires_at_60_fps_within_a_frame() {
    fires_the_kicks_it_fires_at_60_fps(144.0);
}

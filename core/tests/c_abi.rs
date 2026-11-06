// The C ABI (include/visualizer_core.h), what the C++ QML module of specs D and E calls: the same
// Visualizer through create/destroy, configure, push_bands, advance and frame, where no call
// panics or allocates on the hot path whatever pointers and lengths it's handed.
mod common;

use common::*;
use visualizer_core::c_abi::*;

/// Kicks through the C ABI, as `replay` gets them through the Rust API.
fn replay_c(frames: &[Bands], settings: &str) -> Vec<Kick> {
    unsafe {
        let visualizer = visualizer_create();
        assert!(!visualizer.is_null());
        visualizer_configure(visualizer, settings.as_ptr(), settings.len());
        let mut count = (*visualizer_frame(visualizer)).kick_count;
        let mut kicks = Vec::new();
        for f in frames {
            visualizer_push_bands(visualizer, f.values.as_ptr(), f.values.len(), f.time);
            visualizer_advance(visualizer, 1.0 / 60.0);
            let frame = &*visualizer_frame(visualizer);
            if frame.kick_count != count {
                count = frame.kick_count;
                kicks.push(Kick { time: f.time, power: frame.kick_power });
            }
        }
        visualizer_destroy(visualizer);
        kicks
    }
}

#[test]
fn the_c_abi_fires_the_same_kicks_as_the_rust_api() {
    for (config, settings) in CONFIGS {
        for scenario in scenarios() {
            let frames = &fixture(scenario).frames;
            assert_eq!(replay_c(frames, &settings.json()), replay(frames, settings), "{scenario} at {config}");
        }
    }
}

#[test]
fn the_c_abi_tells_the_visualizer_the_active_player_and_ignores_values_it_doesnt_know() {
    use visualizer_core::Silence;
    unsafe {
        let visualizer = visualizer_create();
        let silence = || (*visualizer_frame(visualizer)).silence;
        assert_eq!(silence(), Silence::NoPlayer);
        visualizer_set_player(visualizer, 2);
        assert_eq!(silence(), Silence::None);
        visualizer_set_player(visualizer, 1);
        assert_eq!(silence(), Silence::Paused);
        visualizer_set_player(visualizer, 3);
        visualizer_set_player(visualizer, u32::MAX);
        assert_eq!(silence(), Silence::Paused);
        visualizer_set_player(visualizer, 0);
        assert_eq!(silence(), Silence::NoPlayer);
        visualizer_set_player(std::ptr::null_mut(), 2);
        visualizer_destroy(visualizer);
    }
}

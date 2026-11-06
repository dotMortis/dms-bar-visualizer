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

/// The demo song (harness/lyrics.json) as DMS's lyrics.get reply.
fn song() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../harness/lyrics.json");
    format!(r#"{{"found": true, "synced": {}}}"#, std::fs::read_to_string(path).unwrap())
}

#[test]
fn the_c_abi_shows_the_same_lyric_words_as_the_rust_api() {
    use visualizer_core::{Player, Visualizer};
    let frames = &fixture("steady_house").frames;
    let (letters, advances) = ("aeinorst", [0.55, 0.5, 0.25, 0.55, 0.55, 0.35, 0.45, 0.3]);
    let (song, id) = (song(), "demo");
    let mut rust = Visualizer::new();
    rust.set_seed(42);
    rust.set_bar_size(1200.0, 36.0);
    rust.set_letters(letters, &advances, 1.3);
    rust.set_track(id, 24.0);
    rust.set_lyrics(&song);
    rust.set_player(Player::Playing);
    rust.set_position(0.5, 1.0);
    unsafe {
        let c = visualizer_create();
        visualizer_set_seed(c, 42);
        visualizer_set_bar_size(c, 1200.0, 36.0);
        visualizer_set_letters(c, letters.as_ptr(), letters.len(), advances.as_ptr(), advances.len(), 1.3);
        visualizer_set_track(c, id.as_ptr(), id.len(), 24.0);
        visualizer_set_lyrics(c, song.as_ptr(), song.len());
        visualizer_set_player(c, 2);
        visualizer_set_position(c, 0.5, 1.0);
        let mut most = 0;
        for f in frames {
            rust.push_bands(&f.values, f.time);
            rust.advance(1.0 / 60.0);
            visualizer_push_bands(c, f.values.as_ptr(), f.values.len(), f.time);
            visualizer_advance(c, 1.0 / 60.0);
            let mut count = usize::MAX;
            let glyphs = visualizer_glyphs(c, &mut count);
            assert_eq!(count, rust.glyphs().len());
            assert!(count == 0 || !glyphs.is_null());
            if count > 0 {
                assert_eq!(std::slice::from_raw_parts(glyphs, count), rust.glyphs());
            }
            most = most.max(count);
        }
        assert!(most > 20, "the words did show: {most} glyphs at most");
        // Nothing to call on, or no count to fill: ignored, no glyphs.
        let mut count = 7;
        assert!(visualizer_glyphs(std::ptr::null(), &mut count).is_null());
        assert_eq!(count, 0);
        assert!(visualizer_glyphs(c, std::ptr::null_mut()).is_null());
        visualizer_set_lyrics(c, std::ptr::null(), 5);
        visualizer_set_track(c, [0xff, 0xfe].as_ptr(), 2, 1.0);
        visualizer_set_letters(c, letters.as_ptr(), letters.len(), std::ptr::null(), 8, 1.0);
        visualizer_set_seed(std::ptr::null_mut(), 1);
        visualizer_set_position(std::ptr::null_mut(), 1.0, 1.0);
        visualizer_set_bar_size(std::ptr::null_mut(), 1.0, 1.0);
        visualizer_destroy(c);
    }
}

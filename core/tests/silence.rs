// Silence (GLOSSARY.md): no Active Player, the Active Player paused, or it playing but its output
// silent, as audio/silence.mjs tells it (tests/silence.test.mjs, ported). The player comes in by
// set_player, the bands by push_bands, and the clock by advance: cava sends no frames at all once
// its sleep_timer stops it, so the hold runs on display frames, not on capture frames.
use visualizer_core::{Player, Silence, Visualizer, BANDS, SILENCE_HOLD, SILENCE_THRESHOLD};

enum Event {
    /// No Active Player, or the Active Player paused or playing.
    Gone,
    Pause,
    Play,
    /// One frame of bands: one band at 0.5, or all at 0.
    Loud,
    Quiet,
    /// The clock, no frame.
    Tick,
}
use Event::*;

/// Replays (time in s, event) pairs; the Silence case after each.
fn replay(events: &[(f64, Event)]) -> Vec<Silence> {
    let mut visualizer = Visualizer::new();
    let mut now = 0.0;
    let mut loud = [0.0; BANDS];
    loud[1] = 0.5;
    events
        .iter()
        .map(|(time, event)| {
            visualizer.advance(time - now);
            now = *time;
            match event {
                Gone => visualizer.set_player(Player::None),
                Pause => visualizer.set_player(Player::Paused),
                Play => visualizer.set_player(Player::Playing),
                Loud => visualizer.push_bands(&loud, now),
                Quiet => visualizer.push_bands(&[0.0; BANDS], now),
                Tick => {}
            }
            visualizer.frame().silence
        })
        .collect()
}

const HOLD: f64 = SILENCE_HOLD;

#[test]
fn a_new_visualizer_has_no_player() {
    assert_eq!(Visualizer::new().frame().silence, Silence::NoPlayer);
}

#[test]
fn is_no_player_without_an_active_player() {
    assert_eq!(replay(&[(0.0, Gone), (10.0, Tick)]), [Silence::NoPlayer; 2]);
}

#[test]
fn is_paused_while_the_active_player_is_paused() {
    assert_eq!(replay(&[(0.0, Pause), (10.0, Tick)]), [Silence::Paused; 2]);
}

#[test]
fn is_none_while_the_active_player_plays_and_its_output_sounds() {
    let events = [(0.0, Play), (0.5, Loud), (1.5, Loud), (3.0, Loud), (4.5, Loud)];
    assert_eq!(replay(&events), [Silence::None; 5]);
}

#[test]
fn is_silent_once_the_bands_stay_below_the_threshold_for_the_hold_time() {
    let events =
        [(0.0, Play), (1.0, Loud), (1.5, Quiet), (1.0 + HOLD - 0.1, Quiet), (1.0 + HOLD, Quiet), (6.0 + HOLD, Quiet)];
    use Silence::*;
    assert_eq!(replay(&events), [None, None, None, None, Silent, Silent]);
}

#[test]
fn is_silent_after_the_hold_time_with_no_frames_at_all() {
    let events = [(0.0, Play), (1.0, Loud), (1.0 + HOLD - 0.1, Tick), (1.0 + HOLD, Tick), (60.0, Tick)];
    use Silence::*;
    assert_eq!(replay(&events), [None, None, None, Silent, Silent]);
}

#[test]
fn counts_the_hold_time_from_the_start_of_playing_when_no_frame_came_yet() {
    let events = [(10.0, Pause), (20.0, Play), (20.0 + HOLD - 0.1, Tick), (20.0 + HOLD, Tick)];
    use Silence::*;
    assert_eq!(replay(&events), [Paused, None, None, Silent]);
}

#[test]
fn ends_on_the_first_sound() {
    let events = [(0.0, Play), (30.0, Tick), (31.0, Loud), (31.1, Quiet)];
    use Silence::*;
    assert_eq!(replay(&events), [None, Silent, None, None]);
}

#[test]
fn goes_from_playing_to_paused_to_no_player_and_back() {
    let events = [(0.0, Play), (1.0, Loud), (2.0, Pause), (30.0, Gone), (40.0, Play), (40.5, Loud)];
    use Silence::*;
    assert_eq!(replay(&events), [None, None, Paused, NoPlayer, None, None]);
}

#[test]
fn treats_bands_just_under_the_threshold_as_silent_and_at_it_as_sound() {
    assert_eq!(SILENCE_THRESHOLD, 0.02);
    let mut visualizer = Visualizer::new();
    visualizer.set_player(Player::Playing);
    visualizer.advance(1.0);
    visualizer.push_bands(&[SILENCE_THRESHOLD * 0.99; BANDS], 1.0);
    visualizer.advance(HOLD);
    assert_eq!(visualizer.frame().silence, Silence::Silent);
    let mut bands = [0.0; BANDS];
    bands[0] = SILENCE_THRESHOLD;
    visualizer.push_bands(&bands, HOLD + 1.0);
    assert_eq!(visualizer.frame().silence, Silence::None);
}

#[test]
fn a_player_that_stops_playing_stops_the_capture_so_the_bands_read_as_silent() {
    // AudioPipeline.qml stops cava and zeroes the bands; the Kicks so far stay.
    let mut visualizer = Visualizer::new();
    visualizer.set_player(Player::Playing);
    visualizer.push_bands(&[0.5; BANDS], 0.0);
    let kick = visualizer.frame().kick;
    visualizer.set_player(Player::Paused);
    let frame = visualizer.frame();
    assert_eq!(frame.bands, [0.0; BANDS]);
    assert_eq!((frame.bass, frame.mid, frame.treble), (0.0, 0.0, 0.0));
    assert_eq!(frame.kick, kick);
}

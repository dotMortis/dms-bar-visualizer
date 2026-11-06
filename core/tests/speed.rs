// speed scales the animation clock: kickCooldown runs on it, the smoothing runs on real time.
// Ported from tests/speed.test.mjs.
mod common;

use common::*;

fn with(kick_cooldown: f64, speed: f64) -> Config {
    Config { kick_cooldown, speed: Some(speed), ..SENSITIVE }
}

#[test]
fn kick_cooldown_is_in_animation_seconds_at_speed_2_it_lasts_half_as_long() {
    for scenario in scenarios() {
        let frames = &fixture(scenario).frames;
        assert_eq!(replay(frames, with(0.3, 2.0)), replay(frames, with(0.15, 1.0)), "{scenario}");
    }
}

#[test]
fn kick_cooldown_is_in_animation_seconds_at_speed_0_5_it_lasts_twice_as_long() {
    for scenario in scenarios() {
        let frames = &fixture(scenario).frames;
        assert_eq!(replay(frames, with(0.06, 0.5)), replay(frames, with(0.12, 1.0)), "{scenario}");
    }
}

#[test]
fn at_speed_0_the_cooldown_never_runs_out_so_only_the_first_kick_fires() {
    let frames = &fixture("kick_only").frames;
    assert_eq!(replay(frames, Config { speed: Some(0.0), ..SENSITIVE }).len(), 1);
}

#[test]
fn speed_doesnt_change_how_fast_the_smoothing_follows_the_music() {
    // Without a cooldown, speed has nothing left to change.
    for scenario in scenarios() {
        let frames = &fixture(scenario).frames;
        let at_speed_1 = replay(frames, with(0.0, 1.0));
        for speed in [0.0, 0.5, 2.0] {
            assert_eq!(replay(frames, with(0.0, speed)), at_speed_1, "{scenario} at speed {speed}");
        }
    }
}

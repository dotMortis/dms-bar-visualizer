// configure() takes config.json's text with v0.10.0's keys, defaults and meanings (docs/config.mjs):
// a key that's missing or of the wrong type gets its default, unknown keys are ignored, broken JSON
// keeps the last good settings, and a value nothing can mean is clamped.
mod common;

use common::*;
use visualizer_core::Visualizer;

/// The config.json v0.10.0's shell.qml writes when there is none.
const V0_10_0_DEFAULTS: &str = r#"{
    "barThickness": 40, "spacing": 4, "radius": 12, "followMaximize": true,
    "intensity": 1.0, "speed": 1.0, "kickThreshold": 0.4, "kickDecay": 6.0,
    "kickLowHz": 20, "kickHighHz": 90, "kickCooldown": 0.1, "bassStretch": 1.4, "lyrics": true,
    "lockRing": {
        "handWaves": 1.0, "ringSize": 0.4, "intensityPercent": 100, "kickLowHzPercent": 100,
        "kickHighHzPercent": 100, "kickThresholdPercent": 100, "kickCooldownPercent": 100, "lyrics": true
    }
}"#;

fn kicks_on(settings: &str) -> Vec<Kick> {
    replay_json(&fixture("zoo1").frames, settings)
}

#[test]
fn v0_10_0s_defaults_are_the_defaults() {
    let defaults = replay(&fixture("zoo1").frames, DEFAULTS);
    assert_eq!(kicks_on(V0_10_0_DEFAULTS), defaults);
    assert_eq!(kicks_on("{}"), defaults);
    assert_eq!(replay_json(&fixture("zoo1").frames, "not configured"), defaults);
    // Not configured at all.
    let mut visualizer = Visualizer::new();
    let mut count = 0;
    for f in &fixture("zoo1").frames {
        visualizer.push_bands(&f.values, f.time);
        count = visualizer.frame().kick_count;
    }
    assert_eq!(count as usize, defaults.len());
}

#[test]
fn a_key_of_the_wrong_type_gets_its_default_and_unknown_keys_are_ignored() {
    let defaults = kicks_on("{}");
    assert_eq!(kicks_on(r#"{"kickThreshold": "0.2", "kickLowHz": null, "speed": [2], "kickCooldown": true}"#), defaults);
    assert_eq!(kicks_on(r#"{"kickThresholds": 0.2, "lockRing": 5, "extra": {"kickThreshold": 0.2}}"#), defaults);
    // Not an object at all: nothing in it.
    assert_eq!(kicks_on("[0.2]"), defaults);
    assert_eq!(kicks_on("null"), defaults);
}

#[test]
fn the_kick_settings_mean_what_they_meant() {
    assert_eq!(kicks_on(&SENSITIVE.json()), replay(&fixture("zoo1").frames, SENSITIVE));
    assert_ne!(kicks_on(&SENSITIVE.json()), kicks_on("{}"));
}

#[test]
fn broken_json_keeps_the_last_good_settings() {
    let frames = &fixture("zoo1").frames;
    let mut visualizer = Visualizer::new();
    visualizer.configure(&SENSITIVE.json());
    for broken in ["", "{", r#"{"kickThreshold": 0.9"#, "kickThreshold: 0.9"] {
        visualizer.configure(broken);
    }
    let mut kicks = Vec::new();
    for f in frames {
        let count = visualizer.frame().kick_count;
        visualizer.push_bands(&f.values, f.time);
        if visualizer.frame().kick_count != count {
            kicks.push(Kick { time: f.time, power: visualizer.frame().kick_power });
        }
    }
    assert_eq!(kicks, replay(frames, SENSITIVE));
}

#[test]
fn a_negative_speed_or_kick_cooldown_counts_as_0() {
    let with = |cooldown: f64, speed: f64| Config { kick_cooldown: cooldown, speed: Some(speed), ..SENSITIVE }.json();
    assert_eq!(kicks_on(&with(-0.5, 1.0)), kicks_on(&with(0.0, 1.0)));
    assert_eq!(kicks_on(&with(0.1, -2.0)), kicks_on(&with(0.1, 0.0)));
    assert_eq!(kicks_on(&with(0.1, -2.0)).len(), 1);
}

#[test]
fn a_negative_kick_decay_counts_as_0() {
    let mut visualizer = Visualizer::new();
    visualizer.configure(r#"{"kickDecay": -5}"#);
    for f in &fixture("kick_only").frames {
        visualizer.push_bands(&f.values, f.time);
        if visualizer.frame().kick_count == 1 {
            break;
        }
    }
    visualizer.advance(1.0);
    assert_eq!(visualizer.frame().kick, 1.0);
}

#[test]
fn frequencies_outside_cavas_range_listen_to_its_end_bands() {
    // cava's bands run from 30 Hz to 14 kHz; kickLowHz 0 listens from its lowest, as 30 Hz does.
    assert_eq!(kicks_on(r#"{"kickLowHz": -100}"#), kicks_on(r#"{"kickLowHz": 30}"#));
    assert_eq!(kicks_on(r#"{"kickHighHz": 1e9}"#), kicks_on(r#"{"kickHighHz": 14000}"#));
}

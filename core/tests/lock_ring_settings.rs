// The Lock Ring kind runs on the bar's settings with its lockRing section's percentages applied
// (ADR 0005), as v0.10.0's docs/config.mjs lockRingSettings() did: its Kicks and its intensity.
// The expected numbers are what lockRingSettings() gave in v0.10.0 for the same config.json.
mod common;

use common::*;
use visualizer_core::{Kind, Visualizer};

fn kicks_of(kind: Kind, settings: &str, scenario: &str) -> (Vec<Kick>, f64) {
    let mut visualizer = Visualizer::new();
    visualizer.set_kind(kind);
    visualizer.configure(settings);
    let mut kicks = Vec::new();
    let mut count = visualizer.frame().kick_count;
    for f in &fixture(scenario).frames {
        visualizer.push_bands(&f.values, f.time);
        let frame = visualizer.frame();
        if frame.kick_count != count {
            count = frame.kick_count;
            kicks.push(Kick { time: f.time, power: frame.kick_power });
        }
    }
    (kicks, visualizer.frame().intensity)
}

#[test]
fn at_100_percent_the_lock_ring_runs_on_the_bars_settings() {
    for scenario in ["zoo1", "steady_house"] {
        let bar = r#"{"intensity": 1.3, "kickLowHz": 40, "kickThreshold": 0.3}"#;
        assert_eq!(kicks_of(Kind::LockRing, bar, scenario), kicks_of(Kind::Bar, bar, scenario), "{scenario}");
    }
}

#[test]
fn each_percentage_scales_its_base_setting() {
    // lockRingSettings() of this gave intensity 0.33, kickThreshold 0.22, kickLowHz 30,
    // kickHighHz 90 and kickCooldown 0.13.
    let ring = r#"{"lockRing": {"kickThresholdPercent": 55, "kickCooldownPercent": 130,
        "kickLowHzPercent": 150, "intensityPercent": 33}}"#;
    let scaled =
        r#"{"intensity": 0.33, "kickThreshold": 0.22, "kickLowHz": 30, "kickHighHz": 90, "kickCooldown": 0.13}"#;
    for scenario in ["zoo1", "dnb_808", "double_kick"] {
        let (kicks, intensity) = kicks_of(Kind::LockRing, ring, scenario);
        assert_eq!(intensity, 0.33);
        assert_eq!(kicks, kicks_of(Kind::Bar, scaled, scenario).0, "{scenario}");
        assert_ne!(kicks, kicks_of(Kind::Bar, ring, scenario).0, "{scenario}: the bar ignores the percentages");
    }
    // And this gave intensity 1.8, kickThreshold 0.3, kickLowHz 20, kickHighHz 200, kickCooldown 0.12.
    let ring = r#"{"intensity": 1.2, "kickLowHz": 40, "kickHighHz": 100, "kickThreshold": 0.4, "kickCooldown": 0.2,
        "lockRing": {"intensityPercent": 150, "kickLowHzPercent": 50, "kickHighHzPercent": 200,
                     "kickThresholdPercent": 75, "kickCooldownPercent": 60}}"#;
    let scaled =
        r#"{"intensity": 1.8, "kickThreshold": 0.3, "kickLowHz": 20, "kickHighHz": 200, "kickCooldown": 0.12}"#;
    let (kicks, intensity) = kicks_of(Kind::LockRing, ring, "zoo2");
    assert_eq!(intensity, 1.8);
    assert_eq!(kicks, kicks_of(Kind::Bar, scaled, "zoo2").0);
}

#[test]
fn a_negative_percentage_counts_as_0_and_there_is_no_upper_limit() {
    let ring = r#"{"lockRing": {"intensityPercent": -50, "kickThresholdPercent": 1000}}"#;
    let (kicks, intensity) = kicks_of(Kind::LockRing, ring, "zoo1");
    assert_eq!(intensity, 0.0);
    assert_eq!(kicks, kicks_of(Kind::Bar, r#"{"kickThreshold": 4}"#, "zoo1").0);
}

#[test]
fn a_cooldown_of_0_stays_0_whatever_its_percentage() {
    let ring = r#"{"kickCooldown": 0, "lockRing": {"kickCooldownPercent": 300}}"#;
    assert_eq!(
        kicks_of(Kind::LockRing, ring, "double_kick").0,
        kicks_of(Kind::Bar, r#"{"kickCooldown": 0}"#, "double_kick").0
    );
}

#[test]
fn the_kind_can_change_and_the_settings_follow_it() {
    let ring = r#"{"lockRing": {"intensityPercent": 150}}"#;
    let mut visualizer = Visualizer::new();
    visualizer.configure(ring);
    assert_eq!(visualizer.frame().intensity, 1.0);
    visualizer.set_kind(Kind::LockRing);
    assert_eq!(visualizer.frame().intensity, 1.5);
    visualizer.set_kind(Kind::Bar);
    assert_eq!(visualizer.frame().intensity, 1.0);
}

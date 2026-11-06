// Replays real cava output, recorded from synthesized tracks with known kick onsets (see
// tests/fixtures/record.py), through the Visualizer, and holds each track to a budget of missed,
// doubled and stray Kicks and of median onset-to-Kick latency. Ported from tests/kick-replay.test.mjs,
// with the same budgets: a change may only lower one. One that has to raise a budget says why,
// with numbers, in its PR.
mod common;

use common::*;

const fn b(missed: usize, doubled: usize, stray: usize, latency: i64) -> Budget {
    Budget { missed, doubled, stray, latency }
}

const DEFAULTS_BUDGETS: [(&str, Budget); 9] = [
    ("kick_only", b(0, 0, 0, 83)),
    ("steady_house", b(0, 0, 0, 86)),
    // The stray is the drone coming in at 1.5 s.
    ("sustained_bass", b(0, 0, 1, 86)),
    // The first two Kicks after the 12 dB drop, while the peak releases.
    ("loud_quiet", b(2, 0, 0, 85)),
    ("dnb_808", b(0, 0, 0, 67)),
    // The beat Kicks right after a 16th note fire 98-121 ms after their onset, as the 16th rings.
    ("double_kick", b(0, 0, 0, 90)),
    // zoo1 at 18.94 s (a soft kick) and 22.81 s, zoo2 at 14.58 and 17.97 s. The last three come
    // while the kick before still rings, and rise less than 0.4 of the peak in the bands above it.
    ("zoo1", b(2, 0, 0, 93)),
    ("zoo2", b(2, 0, 0, 100)),
    ("zoo3", b(0, 0, 0, 105)),
];

const SENSITIVE_BUDGETS: [(&str, Budget); 9] = [
    ("kick_only", b(0, 0, 0, 72)),
    ("steady_house", b(0, 0, 0, 76)),
    // The stray is the drone coming in at 1.5 s.
    ("sustained_bass", b(0, 0, 1, 78)),
    ("loud_quiet", b(0, 0, 0, 71)),
    ("dnb_808", b(0, 0, 0, 56)),
    // The beat Kicks right after a 16th note fire 81-106 ms after their onset, as the 16th rings.
    ("double_kick", b(0, 0, 0, 79)),
    ("zoo1", b(0, 0, 0, 83)),
    ("zoo2", b(0, 0, 0, 84)),
    ("zoo3", b(0, 0, 0, 88)),
];

fn check(config: &str, settings: Config, budgets: &[(&str, Budget)]) {
    let mut failures = Vec::new();
    for &(scenario, budget) in budgets {
        let fixture = fixture(scenario);
        let kicks = replay(&fixture.frames, settings);
        let result = score(&fixture.onsets, &times(&kicks));
        println!(
            "{config} {scenario:16} onsets {:3} kicks {:3} missed {} doubled {} stray {} late {} latency {:.0} ms",
            fixture.onsets.len(),
            kicks.len(),
            result.missed.len(),
            result.doubled.len(),
            result.stray.len(),
            result.late.len(),
            result.latency * 1000.0
        );
        let over = over_budget(&result, budget);
        if !over.is_empty() {
            failures.push(format!("{scenario} at {config} ({}): {}", fixture.about, over.join("; ")));
        }
    }
    assert!(failures.is_empty(), "over budget:\n{}", failures.join("\n"));
}

#[test]
fn every_track_stays_within_its_budget_at_the_defaults() {
    check("defaults", DEFAULTS, &DEFAULTS_BUDGETS);
}

#[test]
fn every_track_stays_within_its_budget_at_a_sensitive_setting() {
    check("sensitive", SENSITIVE, &SENSITIVE_BUDGETS);
}

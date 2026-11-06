// One kick drum hit fires one Kick, at any kickThreshold the demo's slider offers (0.06 to 0.9):
// lowering it makes more hits fire, and never makes one hit fire twice.
// Ported from tests/one-kick-per-hit.test.mjs.
mod common;

use common::*;

#[test]
fn sixteenth_note_kick_pairs_further_apart_than_kick_cooldown_fire_as_two_kicks() {
    for (config, settings) in CONFIGS {
        // double_kick has a softer kick a 16th note (121 ms) before every 4th beat, so the beat's
        // kick comes while the 16th still rings.
        let fixture = fixture("double_kick");
        let onsets = &fixture.onsets;
        let pairs: Vec<(f64, f64)> = onsets.windows(2).filter(|w| w[1] - w[0] < 0.2).map(|w| (w[0], w[1])).collect();
        assert_eq!(pairs.len(), 10);
        assert!(pairs.iter().all(|(a, b)| b - a > settings.kick_cooldown));
        let missed = score(onsets, &times(&replay(&fixture.frames, settings))).missed;
        let lost: Vec<f64> = pairs.iter().flat_map(|&(a, b)| [a, b]).filter(|t| missed.contains(t)).collect();
        assert!(lost.is_empty(), "at {config}, onsets of a pair without a Kick: {lost:?}");
    }
}

// The demo's slider, every step below 0.15. At 0.05, zoo3 loses its onset at 7.81 s: a bass
// note swelling by 0.06 of the peak fires just before it, and holds back the Kick after it.
const THRESHOLDS: [f64; 20] =
    [0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.35, 0.3, 0.25, 0.2, 0.15, 0.14, 0.13, 0.12, 0.11, 0.1, 0.09, 0.08, 0.07, 0.06];

fn lowering_fires_more_hits_and_none_twice(kick_cooldown: f64) {
    for scenario in tracks() {
        let fixture = fixture(scenario);
        let mut caught: Vec<f64> = Vec::new();
        for kick_threshold in THRESHOLDS {
            let settings = Config { kick_threshold, kick_cooldown, ..DEFAULTS };
            let result = score(&fixture.onsets, &times(&replay(&fixture.frames, settings)));
            assert!(
                result.doubled.is_empty(),
                "{scenario} at kickThreshold {kick_threshold}: onsets that fire twice: {:?}",
                result.doubled
            );
            let lost: Vec<f64> = caught.iter().copied().filter(|t| result.missed.contains(t)).collect();
            assert!(
                lost.is_empty(),
                "{scenario}: onsets that fire at a higher kickThreshold but not at {kick_threshold}: {lost:?}"
            );
            caught = fixture.onsets.iter().copied().filter(|t| !result.missed.contains(t)).collect();
        }
    }
}

#[test]
fn lowering_kick_threshold_fires_more_hits_and_none_twice_at_kick_cooldown_0_1() {
    lowering_fires_more_hits_and_none_twice(0.1);
}

#[test]
fn lowering_kick_threshold_fires_more_hits_and_none_twice_at_kick_cooldown_0_12() {
    lowering_fires_more_hits_and_none_twice(0.12);
}

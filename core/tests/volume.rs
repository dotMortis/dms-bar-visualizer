// cava's autosens rescales its output all the time and takes over 10 s to catch up after a loud
// passage, so the same kick can come out of cava at very different levels. kickThreshold is a
// fraction of the kick range's recent peak, so it means the same at any level.
// Ported from tests/volume.test.mjs.
mod common;

use common::*;
use visualizer_core::BANDS;

/// The frames with every band scaled by gain, as if cava showed the music that much quieter.
fn scaled(frames: &[Bands], gain: f64) -> Vec<Bands> {
    frames.iter().map(|f| Bands { time: f.time, values: f.values.iter().map(|v| v * gain).collect() }).collect()
}

fn kicks_at(kicks: &[Kick]) -> Vec<String> {
    kicks.iter().map(|k| format!("{:.3} s, power {:.6}", k.time, k.power)).collect()
}

#[test]
fn music_6_or_12_db_quieter_fires_the_same_kicks_with_the_same_power() {
    for (config, settings) in CONFIGS {
        for scenario in scenarios() {
            let frames = &fixture(scenario).frames;
            let kicks = replay(frames, settings);
            for (db, gain) in [(6, 0.5), (12, 0.25)] {
                // Apart from the first Kick out of silence: before the music has set a peak, a
                // fixed floor decides what counts as silence, so quieter music fires it a frame
                // or two later.
                let quieter = replay(&scaled(frames, gain), settings);
                assert_eq!(
                    kicks_at(quieter.get(1..).unwrap_or(&[])),
                    kicks_at(kicks.get(1..).unwrap_or(&[])),
                    "{scenario} at {config}, {db} dB quieter"
                );
            }
        }
    }
}

#[test]
fn kicks_come_back_within_1_5_s_after_the_music_drops_by_12_db() {
    // v0.4.1 missed all 23 Kicks after the drop at the defaults: autosens was still scaled for
    // the loud part, so the quieter kicks never jumped by kickThreshold.
    for (config, settings) in CONFIGS {
        let fixture = fixture("loud_quiet");
        let drop = 12.0; // see the scenario in tests/fixtures/record.py
        let missed = score(&fixture.onsets, &times(&replay(&fixture.frames, settings))).missed;
        let late: Vec<f64> = missed.into_iter().filter(|&t| t > drop + 1.5).collect();
        assert!(late.is_empty(), "at {config}, missed onsets after the drop at {drop} s: {late:?}");
    }
}

#[test]
fn kicks_come_back_within_2_s_after_cava_restarts() {
    // The visualizer restarts cava when the player or output changes, which resets autosens, so
    // the new cava's kicks can come out well below the peak the old one left behind. Every
    // recording, cut just after its last kick, is followed 0.25 s later by every recording from
    // just before its first kick: autosens doesn't move in the silence each recording starts
    // with, so from there it is what a freshly started cava shows. The second one also 6 dB
    // quieter, as when the new music's loudest bands (which autosens scales to) are outside the
    // kick range. From 2 s after the restart on, the joined replay must catch every onset that a
    // Visualizer fed only the second recording catches.
    for (config, settings) in CONFIGS {
        for before in tracks() {
            let last = fixture(before);
            let cut = last.onsets.last().unwrap() + 0.15;
            let head: Vec<Bands> = last.frames.iter().filter(|f| f.time <= cut).cloned().collect();
            for after in tracks() {
                let next = fixture(after);
                let start = next.onsets[0] - 0.1;
                let from_start: Vec<Bands> = next.frames.iter().filter(|f| f.time >= start).cloned().collect();
                for (db, gain) in [(0, 1.0), (6, 0.5)] {
                    let fresh = scaled(&from_start, gain);
                    let shift = head.last().unwrap().time + 0.25 - start; // fresh's clock to the joined one
                    let mut joined = head.clone();
                    joined.extend(fresh.iter().map(|f| Bands { time: f.time + shift, values: f.values.clone() }));
                    let kicks: Vec<f64> =
                        replay(&joined, settings).iter().map(|k| k.time - shift).filter(|&t| t >= start).collect();
                    let caught = score(&next.onsets, &times(&replay(&fresh, settings))).missed;
                    let lost: Vec<f64> = score(&next.onsets, &kicks)
                        .missed
                        .into_iter()
                        .filter(|&t| t >= start + 2.0 && !caught.contains(&t))
                        .collect();
                    assert!(
                        lost.is_empty(),
                        "at {config}, {before} then {after}, {db} dB quieter: onsets missed after the restart: {lost:?}"
                    );
                }
            }
        }
    }
}

// The shader scales a Kick's Shockwave and Spray by its power.
#[test]
fn kick_power_stays_within_0_5_to_1_at_any_kick_threshold() {
    for kick_threshold in [0.0, 0.1, 0.2, 0.4, 0.6, 0.8] {
        for scenario in scenarios() {
            let kicks = replay(&fixture(scenario).frames, Config { kick_threshold, ..DEFAULTS });
            let out: Vec<f64> = kicks.iter().map(|k| k.power).filter(|p| !(0.5..=1.0).contains(p)).collect();
            assert!(out.is_empty(), "{scenario} at kickThreshold {kick_threshold}: {out:?}");
        }
    }
}

#[test]
fn a_hit_louder_than_the_recent_kicks_fires_at_full_power_steady_ones_weaker() {
    // A steady beat, then 12 dB louder from one hit on. The steady Kicks (once the start is 2 s
    // behind) all hit as hard as the ones before them, so none reaches full power.
    for (config, settings) in CONFIGS {
        for scenario in ["kick_only", "steady_house"] {
            let fixture = fixture(scenario);
            let step = fixture.onsets.iter().find(|&&t| t > 12.0).unwrap() - 0.03;
            let louder_from: Vec<Bands> = fixture
                .frames
                .iter()
                .map(|f| if f.time < step { scaled(std::slice::from_ref(f), 0.25).remove(0) } else { f.clone() })
                .collect();
            let kicks = replay(&louder_from, settings);
            let steady: Vec<Kick> = kicks.iter().copied().filter(|k| k.time > 4.0 && k.time < step).collect();
            let louder = kicks.iter().find(|k| k.time > step).unwrap();
            assert!(
                steady.len() > 10 && steady.iter().all(|k| k.power < 1.0),
                "{scenario} at {config}, steady: {:?}",
                kicks_at(&steady)
            );
            assert_eq!(
                louder.power,
                1.0,
                "{scenario} at {config}, first Kick 12 dB louder: {:?}",
                kicks_at(&[*louder])
            );
        }
    }
}

#[test]
fn a_hit_quieter_than_the_recent_kicks_fires_weaker() {
    // The first Kick after the 12 dB drop in loud_quiet against the ones before the drop.
    for (config, settings) in CONFIGS {
        let kicks = replay(&fixture("loud_quiet").frames, settings);
        let mut before: Vec<f64> = kicks.iter().filter(|k| k.time > 4.0 && k.time < 12.0).map(|k| k.power).collect();
        before.sort_by(f64::total_cmp);
        let quieter = kicks.iter().find(|k| k.time > 12.0).unwrap();
        let median = before[before.len() / 2];
        assert!(
            quieter.power < median,
            "at {config}, first Kick after the drop {:?}, median before {median}",
            kicks_at(&[*quieter])
        );
    }
}

#[test]
fn a_band_that_cant_fire_a_kick_doesnt_add_to_its_power() {
    // A hit at 1 s rings on in band 1 and dies down in bands 2-6. At 1.25 s a new one comes in,
    // in band 4, above where the last one rings. Band 0, below it, can't fire a Kick: whether it
    // jumps at the same time or not, the Kick is the same.
    let hits = |band0: f64| -> Vec<Bands> {
        (0..90)
            .map(|n| {
                let time = n as f64 / 60.0;
                let mut values = vec![0.0; BANDS];
                if time >= 1.0 {
                    values[1] = 0.8;
                    for v in &mut values[2..=6] {
                        *v = 0.1 + 0.65 * (-(time - 1.0) / 0.04).exp();
                    }
                }
                if time >= 1.25 {
                    values[4] = 0.6;
                    values[0] = band0;
                }
                Bands { time, values }
            })
            .collect()
    };
    for (config, settings) in CONFIGS {
        let alone = replay(&hits(0.0), settings);
        assert_eq!(times(&alone), [1.0, 1.25], "at {config}");
        assert_eq!(kicks_at(&replay(&hits(0.7), settings)), kicks_at(&alone), "at {config}");
    }
}

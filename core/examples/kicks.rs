// The native side of the parity check (core/parity.mjs): every fixture's Kicks at both replay
// configs, one JSON line per replay, {scenario, config, settings, kicks: [[time, power], ...],
// frame, ringSettings, ring}, with every number written exactly (shortest round trip). `frame` is
// the last frame of the same replay with the player playing and a 60 fps display frame after each
// capture frame: [time, flow, kick, intensity, bassStretch, ...kickAges, ...kickPowers,
// ...kickSeeds, silence, animating (0 or 1)]. `ring` is the last state of the same replay with the
// Visualizer configured as the Lock Ring (on `ringSettings`: the config with some lockRing
// percentages) and the local time running from 10:00 at 60 fps: ring_flat()'s numbers.
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use visualizer_core::{Kind, LockRingFrame, Player, Visualizer};

fn last_frame(frames: &[Bands], settings: &str) -> Vec<f64> {
    let mut visualizer = Visualizer::new();
    visualizer.configure(settings);
    visualizer.set_player(Player::Playing);
    for f in frames {
        visualizer.push_bands(&f.values, f.time);
        visualizer.advance(1.0 / 60.0);
    }
    let f = visualizer.frame();
    let mut out = vec![f.time, f.flow, f.kick, f.intensity, f.bass_stretch];
    out.extend(f.kick_ages);
    out.extend(f.kick_powers);
    out.extend(f.kick_seeds);
    out.extend([f.silence as u32 as f64, f.animating as u8 as f64]);
    out
}

/// The frame's intensity and Kick count, then every number of the Lock Ring's state in its fields'
/// order. core/parity.mjs reads the WASM's frame() and lockRing() in the same order.
fn ring_flat(intensity: f64, kick_count: u32, r: &LockRingFrame) -> Vec<f64> {
    let mut out = vec![intensity, kick_count as f64, r.swell, r.presence, r.hand_flash];
    for hands in [
        r.hand_angles,
        r.hand_inner,
        r.hand_lengths,
        r.hand_amplitudes,
        r.hand_widths,
        r.hand_glows,
        r.hand_phases,
        r.hand_levels,
    ] {
        out.extend(hands);
    }
    out.extend(r.kick_ages);
    out.extend(r.kick_powers);
    out.extend(r.kick_seeds);
    out.extend(r.hour_radii);
    out.extend(r.hour_glows);
    out.push(r.time_crossing);
    let h = &r.time_hit;
    out.extend(h.copy_offsets);
    out.extend([h.copy_opacity, h.glow_opacity, h.glow_scale, h.white]);
    out
}

/// Some lockRing percentages on top of a replay config, so the parity check covers them too.
const RING_PERCENTAGES: &str = r#""lockRing": {"intensityPercent": 120, "kickThresholdPercent": 90, "handWaves": 1.2}"#;

fn last_ring(frames: &[Bands], settings: &str) -> Vec<f64> {
    let mut visualizer = Visualizer::new();
    visualizer.set_kind(Kind::LockRing);
    visualizer.configure(settings);
    visualizer.set_player(Player::Playing);
    for (i, f) in frames.iter().enumerate() {
        visualizer.set_local_time(36000.0 + i as f64 / 60.0);
        visualizer.push_bands(&f.values, f.time);
        visualizer.advance(1.0 / 60.0);
    }
    let f = visualizer.frame();
    ring_flat(f.intensity, f.kick_count, &visualizer.lock_ring())
}

fn numbers(xs: &[f64]) -> String {
    xs.iter().map(|x| format!("{x:?}")).collect::<Vec<_>>().join(",")
}

fn main() {
    for scenario in scenarios() {
        for (config, settings) in CONFIGS {
            let settings = settings.json();
            let frames = &fixture(scenario).frames;
            let kicks = replay_json(frames, &settings);
            let kicks: Vec<String> = kicks.iter().map(|k| format!("[{:?},{:?}]", k.time, k.power)).collect();
            let ring_settings = format!("{}, {RING_PERCENTAGES}}}", settings.trim_end_matches('}'));
            println!(
                r#"{{"scenario":{},"config":"{config}","settings":{},"kicks":[{}],"frame":[{}],"ringSettings":{},"ring":[{}]}}"#,
                serde_json::Value::from(scenario),
                serde_json::Value::from(settings.as_str()),
                kicks.join(","),
                numbers(&last_frame(frames, &settings)),
                serde_json::Value::from(ring_settings.as_str()),
                numbers(&last_ring(frames, &ring_settings))
            );
        }
    }
}

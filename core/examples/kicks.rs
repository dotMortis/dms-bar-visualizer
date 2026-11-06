// The native side of the parity check (core/parity.mjs): every fixture's Kicks at both replay
// configs, one JSON line per replay, {scenario, config, settings, kicks: [[time, power], ...],
// frame}, with every number written exactly (shortest round trip). `frame` is the last frame of
// the same replay with the player playing and a 60 fps display frame after each capture frame:
// [time, flow, kick, intensity, bassStretch, ...kickAges, ...kickPowers, ...kickSeeds, silence,
// animating (0 or 1)].
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use visualizer_core::{Player, Visualizer};

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

fn main() {
    for scenario in scenarios() {
        for (config, settings) in CONFIGS {
            let settings = settings.json();
            let frames = &fixture(scenario).frames;
            let kicks = replay_json(frames, &settings);
            let kicks: Vec<String> = kicks.iter().map(|k| format!("[{:?},{:?}]", k.time, k.power)).collect();
            let frame: Vec<String> = last_frame(frames, &settings).iter().map(|x| format!("{x:?}")).collect();
            println!(
                r#"{{"scenario":{},"config":"{config}","settings":{},"kicks":[{}],"frame":[{}]}}"#,
                serde_json::Value::from(scenario),
                serde_json::Value::from(settings),
                kicks.join(","),
                frame.join(",")
            );
        }
    }
}

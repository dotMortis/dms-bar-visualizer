// The native side of the parity check (core/parity.mjs): every fixture's Kicks at both replay
// configs, one JSON line per replay, {scenario, config, settings, kicks: [[time, power], ...]},
// with every number written exactly (shortest round trip).
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;

fn main() {
    for scenario in scenarios() {
        for (config, settings) in CONFIGS {
            let settings = settings.json();
            let kicks = replay_json(&fixture(scenario).frames, &settings);
            let kicks: Vec<String> = kicks.iter().map(|k| format!("[{:?},{:?}]", k.time, k.power)).collect();
            println!(
                r#"{{"scenario":{},"config":"{config}","settings":{},"kicks":[{}]}}"#,
                serde_json::Value::from(scenario),
                serde_json::Value::from(settings),
                kicks.join(",")
            );
        }
    }
}

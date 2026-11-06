// The native side of the parity check's Lyric Words (core/parity.mjs): the demo song
// (harness/lyrics.json) sung over a fixture's replay, on a 1200 x 36 bar and on a 600 px Lock Ring,
// their glyphs every GLYPH_EVERY display frames, as one JSON line {glyphs: [[...], ...], ring:
// [[...], ...]}, every number written exactly (shortest round trip). parity.mjs runs the same
// through the WASM build.
#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use visualizer_core::{Kind, Player, Visualizer, GLYPH_FIELDS};

/// The runs both builds make: what parity.mjs's `glyphRun` does through the WASM API.
const SCENARIO: &str = "steady_house";
const GLYPH_EVERY: usize = 15;
const LETTERS: &str = "abcdefghijklmnopqrstuvwxyzENRVWS,";
/// The Lock Ring's run: its side in pixels, and its local time at the first frame (10:00).
const RING_SIDE: f64 = 600.0;
const RING_TIME: f64 = 36000.0;

fn run(kind: Kind) -> String {
    let song = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../harness/lyrics.json")).unwrap();
    let advances: Vec<f64> = (0..LETTERS.chars().count()).map(|i| 0.3 + 0.01 * i as f64).collect();
    let mut visualizer = Visualizer::new();
    visualizer.configure(&DEFAULTS.json());
    visualizer.set_kind(kind);
    visualizer.set_seed(42);
    visualizer.set_bar_size(1200.0, 36.0);
    visualizer.set_ring_size(RING_SIDE);
    visualizer.set_letters(LETTERS, &advances, 1.3);
    visualizer.set_track("demo", 24.0);
    visualizer.set_lyrics(&format!(r#"{{"found": true, "synced": {song}}}"#));
    visualizer.set_player(Player::Playing);
    visualizer.set_position(0.5, 1.0);
    let mut snapshots = Vec::new();
    for (n, f) in fixture(SCENARIO).frames.iter().enumerate() {
        visualizer.set_local_time(RING_TIME + n as f64 / 60.0);
        visualizer.push_bands(&f.values, f.time);
        visualizer.advance(1.0 / 60.0);
        if n % GLYPH_EVERY == 0 {
            let numbers: Vec<String> = visualizer
                .glyphs()
                .iter()
                .flat_map(|g| {
                    // A Glyph is GLYPH_FIELDS doubles.
                    let fields: [f64; GLYPH_FIELDS] = unsafe { std::mem::transmute(*g) };
                    fields
                })
                .map(|x| format!("{x:?}"))
                .collect();
            snapshots.push(format!("[{}]", numbers.join(",")));
        }
    }
    snapshots.join(",")
}

fn main() {
    println!(r#"{{"glyphs":[{}],"ring":[{}]}}"#, run(Kind::Bar), run(Kind::LockRing));
}

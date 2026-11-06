// The Bar Ribbons' numbers live once, in the core (src/ribbons.rs). The shaders can't import them,
// so shaders/viz.frag and the demo's port of it in docs/index.html repeat them. These checks keep
// both copies on the core's, as tests/bar-constants.test.mjs did for docs/bar-ribbons.mjs.
use std::collections::BTreeMap;
use std::path::Path;

use visualizer_core::ribbons::*;
use visualizer_core::KICK_SLOTS;

fn read(file: &str) -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::read_to_string(root.join(file)).unwrap_or_else(|e| panic!("{file}: {e}"))
}

/// The demo's port: the GLSL in index.html's FRAG template string.
fn demo_frag() -> String {
    let html = read("docs/index.html");
    let start = html.find("const FRAG = `").expect("index.html's FRAG");
    let end = start + html[start..].find("`;").unwrap();
    html[start..end].to_owned()
}

fn shaders() -> [(&'static str, String); 2] {
    [("shaders/viz.frag", read("shaders/viz.frag")), ("docs/index.html", demo_frag())]
}

/// A shader's `const <type> NAME = value;` lines, by name: the value's text.
fn shader_constants(source: &str, kind: &str) -> BTreeMap<String, String> {
    let prefix = format!("const {kind} ");
    source
        .lines()
        .filter_map(|line| line.strip_prefix(&prefix))
        .filter_map(|rest| {
            let (name, value) = rest.split_once('=')?;
            Some((name.trim().to_owned(), value.split(';').next()?.trim().to_owned()))
        })
        .collect()
}

const NUMBERS: [(&str, f64); 25] = [
    ("RIBBON_FREQ", RIBBON_FREQ),
    ("RIBBON_FREQ_STEP", RIBBON_FREQ_STEP),
    ("RIBBON_SPEED_STEP", RIBBON_SPEED_STEP),
    ("RIBBON_OFFSET", RIBBON_OFFSET),
    ("RIBBON_RIPPLE", RIBBON_RIPPLE),
    ("RIBBON_RIPPLE_FREQ", RIBBON_RIPPLE_FREQ),
    ("RIBBON_RIPPLE_PHASE", RIBBON_RIPPLE_PHASE),
    ("RIBBON_REACH", RIBBON_REACH),
    ("RIBBON_HUE_STEP", RIBBON_HUE_STEP),
    ("RIBBON_HUE_SPREAD", RIBBON_HUE_SPREAD),
    ("RIBBON_HUE_LEVEL", RIBBON_HUE_LEVEL),
    ("RIBBON_DEEP", RIBBON_DEEP),
    ("HUE_SPEED", HUE_SPEED),
    ("HUE_ALONG", HUE_ALONG),
    ("HUE_DEEPEN", HUE_DEEPEN),
    ("LEVEL_GAIN", LEVEL_GAIN),
    ("LEVEL_KICK", LEVEL_KICK),
    ("LEVEL_SURGE", LEVEL_SURGE),
    ("SHOCK_GROW", SHOCK_GROW),
    ("SHOCK_FADE", SHOCK_FADE),
    ("SHOCK_WIDTH", SHOCK_WIDTH),
    ("SHAKE_X", SHAKE_X),
    ("SHAKE_Y", SHAKE_Y),
    ("SHAKE_FREQ_X", SHAKE_FREQ_X),
    ("SHAKE_FREQ_Y", SHAKE_FREQ_Y),
];

const COLORS: [(&str, [f64; 3]); 4] = [("LAVENDER", LAVENDER), ("MAUVE", MAUVE), ("PINK", PINK), ("BLUE", BLUE)];

#[test]
fn the_shaders_ribbon_constants_match_the_cores() {
    for (file, source) in shaders() {
        let frag = shader_constants(&source, "float");
        for (name, value) in NUMBERS {
            let text = frag.get(name).unwrap_or_else(|| panic!("{file} defines {name}"));
            let theirs: f64 = text.parse().unwrap_or_else(|_| panic!("{file}'s {name}: {text}"));
            assert!((theirs - value).abs() < 1e-9, "{name}: {file} has {theirs}, the core {value}");
        }
    }
}

#[test]
fn the_shaders_palette_matches_the_cores() {
    for (file, source) in shaders() {
        let frag = shader_constants(&source, "vec3");
        for (name, rgb) in COLORS {
            let text = frag.get(name).unwrap_or_else(|| panic!("{file} defines {name}"));
            let inner = text.strip_prefix("vec3(").and_then(|t| t.strip_suffix(')')).expect("vec3(r, g, b)");
            let theirs: Vec<f64> = inner.split(',').map(|c| c.trim().parse().unwrap()).collect();
            assert_eq!(theirs, rgb, "{file}'s {name}");
        }
    }
}

#[test]
fn the_shaders_play_as_many_kicks_as_the_core_keeps() {
    for (file, source) in shaders() {
        let ints = shader_constants(&source, "int");
        if let Some(kicks) = ints.get("KICKS") {
            let kicks = kicks.split_whitespace().next().unwrap();
            assert_eq!(kicks.parse::<usize>().unwrap(), KICK_SLOTS, "{file}'s KICKS");
        } else {
            // The demo's port sizes its uniform arrays instead.
            assert!(source.contains(&format!("kickAges[{KICK_SLOTS}]")), "{file} keeps {KICK_SLOTS} Kicks");
        }
    }
}

/// Whether `literal` appears in `code` as a number of its own.
fn spells(code: &str, literal: &str) -> bool {
    code.match_indices(literal).any(|(i, _)| {
        let before = code[..i].chars().next_back();
        let after = code[i + literal.len()..].chars().next();
        !before.is_some_and(|c| c.is_ascii_digit() || c == '.') && !after.is_some_and(|c| c.is_ascii_digit())
    })
}

#[test]
fn the_shaders_draw_the_ribbons_from_the_constants_not_their_own_copies() {
    for (file, source) in shaders() {
        let code: String = source
            .lines()
            .filter(|line| !line.starts_with("const float "))
            .map(|line| line.split("//").next().unwrap())
            .collect::<Vec<_>>()
            .join("\n");
        for (name, _) in NUMBERS {
            let used = code.match_indices(name).any(|(i, _)| {
                let after = code[i + name.len()..].chars().next();
                let before = code[..i].chars().next_back();
                let word = |c: Option<char>| c.is_some_and(|c| c.is_alphanumeric() || c == '_');
                !word(before) && !word(after)
            });
            assert!(used, "{file} uses {name}");
        }
        for literal in ["2.6", "2.1", "2.3", "0.42", "4.5", "2.2", "0.003", "97.0", "83.0", "0.33"] {
            assert!(!spells(&code, literal), "{file} spells out {literal}");
        }
    }
}

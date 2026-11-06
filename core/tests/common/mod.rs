// Replay recorded cava output through the Visualizer and score its Kicks against the true onsets.
// Shared by the replay tests, as tests/replay.mjs is by the JS ones: the fixtures and configs,
// replaying frames, scoring the Kicks, and checking the result against a budget.
#![allow(dead_code)]

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::OnceLock;

use visualizer_core::{Visualizer, BANDS};

/// One capture frame of a recording.
#[derive(Clone, Debug)]
pub struct Bands {
    pub time: f64,
    pub values: Vec<f64>,
}

/// A recording by tests/fixtures/record.py: the onsets from its header, and its frames.
pub struct Fixture {
    pub about: String,
    pub onsets: Vec<f64>,
    pub frames: Vec<Bands>,
}

/// The kick settings the replay tests hold the detector to, and speed (left out when None).
#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub kick_threshold: f64,
    pub kick_low_hz: f64,
    pub kick_high_hz: f64,
    pub kick_cooldown: f64,
    pub speed: Option<f64>,
}

impl Config {
    /// As config.json's text.
    pub fn json(&self) -> String {
        let speed = self.speed.map(|s| format!(r#", "speed": {s:?}"#)).unwrap_or_default();
        format!(
            r#"{{"kickThreshold": {:?}, "kickLowHz": {:?}, "kickHighHz": {:?}, "kickCooldown": {:?}{speed}}}"#,
            self.kick_threshold, self.kick_low_hz, self.kick_high_hz, self.kick_cooldown
        )
    }
}

pub const DEFAULTS: Config =
    Config { kick_threshold: 0.4, kick_low_hz: 20.0, kick_high_hz: 90.0, kick_cooldown: 0.1, speed: None };
pub const SENSITIVE: Config =
    Config { kick_threshold: 0.2, kick_low_hz: 30.0, kick_high_hz: 90.0, kick_cooldown: 0.1, speed: None };
pub const CONFIGS: [(&str, Config); 2] = [("defaults", DEFAULTS), ("sensitive", SENSITIVE)];

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures")
}

/// Every recording in tests/fixtures, by scenario.
pub fn fixtures() -> &'static BTreeMap<String, Fixture> {
    static FIXTURES: OnceLock<BTreeMap<String, Fixture>> = OnceLock::new();
    FIXTURES.get_or_init(|| {
        let mut out = BTreeMap::new();
        for entry in std::fs::read_dir(fixtures_dir()).expect("tests/fixtures") {
            let path = entry.unwrap().path();
            if path.extension().is_some_and(|e| e == "txt") {
                let name = path.file_stem().unwrap().to_string_lossy().into_owned();
                out.insert(name, read_fixture(&path));
            }
        }
        out
    })
}

pub fn fixture(scenario: &str) -> &'static Fixture {
    &fixtures()[scenario]
}

/// Every scenario, sorted.
pub fn scenarios() -> Vec<&'static str> {
    fixtures().keys().map(String::as_str).collect()
}

/// The scenarios with Kicks (all but the tone sweep).
pub fn tracks() -> Vec<&'static str> {
    fixtures().iter().filter(|(_, f)| !f.onsets.is_empty()).map(|(s, _)| s.as_str()).collect()
}

fn read_fixture(path: &std::path::Path) -> Fixture {
    let text = std::fs::read_to_string(path).unwrap();
    let mut lines = text.trim_end().split('\n');
    let header: serde_json::Value = serde_json::from_str(lines.next().unwrap()).unwrap();
    let onsets = header["onsets"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let about = header["about"].as_str().unwrap_or_default().to_owned();
    let frames = lines
        .filter_map(|line| {
            let (time, raw) = line.split_once(' ')?;
            Some(Bands { time: time.parse().unwrap(), values: parse_bands(raw)? })
        })
        .collect();
    Fixture { about, onsets, frames }
}

/// docs/kick.mjs's parseBands: one line of cava's raw ascii output as the bands in 0..1, None for
/// a line with fewer bands.
fn parse_bands(line: &str) -> Option<Vec<f64>> {
    let parts: Vec<&str> = line.split(';').collect();
    if parts.len() < BANDS || parts[BANDS - 1].is_empty() {
        return None;
    }
    Some(parts[..BANDS].iter().map(|p| p.parse::<f64>().unwrap() / 1000.0).collect())
}

/// One Kick: when the frame that fired it came, and its power.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Kick {
    pub time: f64,
    pub power: f64,
}

/// Push frames through a fresh Visualizer with these settings; its Kicks, on the frames' clock.
pub fn replay(frames: &[Bands], config: Config) -> Vec<Kick> {
    replay_json(frames, &config.json())
}

pub fn replay_json(frames: &[Bands], settings: &str) -> Vec<Kick> {
    let mut visualizer = Visualizer::new();
    visualizer.configure(settings);
    let mut count = visualizer.frame().kick_count;
    let mut kicks = Vec::new();
    for Bands { time, values } in frames {
        visualizer.push_bands(values, *time);
        let frame = visualizer.frame();
        if frame.kick_count != count {
            count = frame.kick_count;
            kicks.push(Kick { time: *time, power: frame.kick_power });
        }
    }
    kicks
}

pub fn times(kicks: &[Kick]) -> Vec<f64> {
    kicks.iter().map(|k| k.time).collect()
}

/// The frames pushed fps times a second instead of 60, the way the demo pushes one frame per display
/// refresh: each frame repeated as often as an fps Hz display refreshes before the next comes, the
/// repeats spread evenly from the frame's own time.
pub fn at_frame_rate(frames: &[Bands], fps: f64) -> Vec<Bands> {
    let start = frames[0].time;
    let refreshes = |time: f64| ((time - start) * fps + 0.5).floor() as i64;
    let mut pushed = Vec::new();
    for (i, frame) in frames.iter().enumerate() {
        let next = frames.get(i + 1).map_or(frame.time, |f| f.time);
        let repeats = (refreshes(next) - refreshes(frame.time)).max(1);
        for j in 0..repeats {
            let time = frame.time + (next - frame.time) * j as f64 / repeats as f64;
            pushed.push(Bands { time, values: frame.values.clone() });
        }
    }
    pushed
}

/// A Kick more than this long after its onset doesn't belong to it.
const WINDOW: f64 = 0.35;
/// A Kick may come this much before its onset: arrival timestamps jitter against the audio clock.
const SLACK: f64 = 0.03;
/// cava can't show an onset sooner than this.
const MIN_LATENCY: f64 = 0.015;
/// A Shockwave this far behind the beat reads as off-beat.
pub const LATE: f64 = 0.15;

#[derive(Debug, Default)]
pub struct Score {
    pub missed: Vec<f64>,
    pub doubled: Vec<f64>,
    pub late: Vec<f64>,
    pub stray: Vec<f64>,
    /// The median delay from onset to first Kick, NaN without any.
    pub latency: f64,
}

/// Score Kick times against the true onsets (both ascending), as tests/replay.mjs does.
pub fn score(onsets: &[f64], kicks: &[f64]) -> Score {
    let mut per_onset: Vec<Vec<f64>> = vec![Vec::new(); onsets.len()];
    let mut stray = Vec::new();
    for &kick in kicks {
        // Each Kick belongs to the latest onset at or before it...
        let mut i: isize = -1;
        while ((i + 1) as usize) < onsets.len() && onsets[(i + 1) as usize] <= kick + SLACK {
            i += 1;
        }
        // ...unless cava couldn't have shown that onset yet, and the one before is still open.
        if i > 0 && kick - onsets[i as usize] < MIN_LATENCY && kick - onsets[i as usize - 1] < WINDOW {
            i -= 1;
        }
        if i >= 0 && kick - onsets[i as usize] < WINDOW {
            per_onset[i as usize].push(kick);
        } else {
            stray.push(kick);
        }
    }
    let latencies: Vec<f64> =
        per_onset.iter().zip(onsets).map(|(own, t)| own.first().map_or(f64::NAN, |k| k - t)).collect();
    let pick = |keep: &dyn Fn(usize) -> bool| -> Vec<f64> {
        onsets.iter().enumerate().filter(|(i, _)| keep(*i)).map(|(_, t)| *t).collect()
    };
    Score {
        missed: pick(&|i| per_onset[i].is_empty()),
        doubled: pick(&|i| per_onset[i].len() > 1),
        late: pick(&|i| latencies[i] > LATE),
        stray,
        latency: median(latencies.into_iter().filter(|l| !l.is_nan()).collect()),
    }
}

fn median(mut xs: Vec<f64>) -> f64 {
    if xs.is_empty() {
        return f64::NAN;
    }
    xs.sort_by(f64::total_cmp);
    let mid = xs.len() / 2;
    if xs.len() % 2 == 1 { xs[mid] } else { (xs[mid - 1] + xs[mid]) / 2.0 }
}

/// A budget of missed, doubled and stray Kicks and of median latency in ms.
#[derive(Clone, Copy, Debug)]
pub struct Budget {
    pub missed: usize,
    pub doubled: usize,
    pub stray: usize,
    pub latency: i64,
}

fn at(times: &[f64]) -> String {
    times.iter().map(|t| format!("{t:.2}")).collect::<Vec<_>>().join(", ")
}

/// What a score exceeds of a budget, one line per symptom; empty when it is within budget.
pub fn over_budget(result: &Score, budget: Budget) -> Vec<String> {
    let mut over = Vec::new();
    for (key, list, limit, what) in [
        ("missed", &result.missed, budget.missed, "onsets"),
        ("doubled", &result.doubled, budget.doubled, "onsets"),
        ("stray", &result.stray, budget.stray, "kicks"),
    ] {
        if list.len() > limit {
            over.push(format!("{key} {} > {limit} ({what} at {} s)", list.len(), at(list)));
        }
    }
    let latency = (result.latency * 1000.0).round();
    if !(latency <= budget.latency as f64) {
        over.push(format!("median latency {latency} ms > {} ms", budget.latency));
    }
    over
}

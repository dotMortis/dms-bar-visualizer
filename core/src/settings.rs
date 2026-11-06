// config.json's keys and their v0.10.0 defaults (docs/config.mjs, ADR 0004), read the way
// docs/config.mjs's parseConfig reads them: a key that's missing, or of another type than its
// default, gets the default; keys without a default are ignored. On top of that, a value the core
// can't run on is clamped (see clamped()).

use serde_json::{Map, Value};

/// Every config.json key. Later parts of the core read the ones the Kicks don't.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Settings {
    pub bar_thickness: f64,
    pub spacing: f64,
    pub radius: f64,
    pub follow_maximize: bool,
    pub intensity: f64,
    pub speed: f64,
    pub kick_threshold: f64,
    pub kick_decay: f64,
    pub kick_low_hz: f64,
    pub kick_high_hz: f64,
    pub kick_cooldown: f64,
    pub bass_stretch: f64,
    pub lyrics: bool,
    pub lock_ring: LockRing,
}

/// The lockRing section: the Lock Ring's own settings.
#[allow(dead_code)]
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LockRing {
    pub hand_waves: f64,
    pub ring_size: f64,
    pub intensity_percent: f64,
    pub kick_low_hz_percent: f64,
    pub kick_high_hz_percent: f64,
    pub kick_threshold_percent: f64,
    pub kick_cooldown_percent: f64,
    pub lyrics: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            bar_thickness: 40.0,
            spacing: 4.0,
            radius: 12.0,
            follow_maximize: true,
            intensity: 1.0,
            speed: 1.0,
            kick_threshold: 0.4,
            kick_decay: 6.0,
            kick_low_hz: 20.0,
            kick_high_hz: 90.0,
            kick_cooldown: 0.1,
            bass_stretch: 1.4,
            lyrics: true,
            lock_ring: LockRing {
                hand_waves: 1.0,
                ring_size: 0.4,
                intensity_percent: 100.0,
                kick_low_hz_percent: 100.0,
                kick_high_hz_percent: 100.0,
                kick_threshold_percent: 100.0,
                kick_cooldown_percent: 100.0,
                lyrics: true,
            },
        }
    }
}

fn number(section: &Map<String, Value>, key: &str, default: f64) -> f64 {
    section.get(key).and_then(Value::as_f64).filter(|v| v.is_finite()).unwrap_or(default)
}

fn boolean(section: &Map<String, Value>, key: &str, default: bool) -> bool {
    section.get(key).and_then(Value::as_bool).unwrap_or(default)
}

impl Settings {
    /// The settings in config.json's text, over the defaults; None for broken JSON, so a
    /// half-written file can keep the last good settings.
    pub fn parse(text: &str) -> Option<Settings> {
        let stored: Value = serde_json::from_str(text).ok()?;
        let empty = Map::new();
        let top = stored.as_object().unwrap_or(&empty);
        let ring = top.get("lockRing").and_then(Value::as_object).unwrap_or(&empty);
        let d = Settings::default();
        let dr = &d.lock_ring;
        Some(
            Settings {
                bar_thickness: number(top, "barThickness", d.bar_thickness),
                spacing: number(top, "spacing", d.spacing),
                radius: number(top, "radius", d.radius),
                follow_maximize: boolean(top, "followMaximize", d.follow_maximize),
                intensity: number(top, "intensity", d.intensity),
                speed: number(top, "speed", d.speed),
                kick_threshold: number(top, "kickThreshold", d.kick_threshold),
                kick_decay: number(top, "kickDecay", d.kick_decay),
                kick_low_hz: number(top, "kickLowHz", d.kick_low_hz),
                kick_high_hz: number(top, "kickHighHz", d.kick_high_hz),
                kick_cooldown: number(top, "kickCooldown", d.kick_cooldown),
                bass_stretch: number(top, "bassStretch", d.bass_stretch),
                lyrics: boolean(top, "lyrics", d.lyrics),
                lock_ring: LockRing {
                    hand_waves: number(ring, "handWaves", dr.hand_waves),
                    ring_size: number(ring, "ringSize", dr.ring_size),
                    intensity_percent: number(ring, "intensityPercent", dr.intensity_percent),
                    kick_low_hz_percent: number(ring, "kickLowHzPercent", dr.kick_low_hz_percent),
                    kick_high_hz_percent: number(ring, "kickHighHzPercent", dr.kick_high_hz_percent),
                    kick_threshold_percent: number(ring, "kickThresholdPercent", dr.kick_threshold_percent),
                    kick_cooldown_percent: number(ring, "kickCooldownPercent", dr.kick_cooldown_percent),
                    lyrics: boolean(ring, "lyrics", dr.lyrics),
                },
            }
            .clamped(),
        )
    }

    /// The settings the Lock Ring runs on (ADR 0005): these, with the lockRing section's
    /// percentages of intensity and the Kick settings applied, as v0.10.0's lockRingSettings() in
    /// docs/config.mjs. A negative percentage counts as 0; there is no upper limit, but a result
    /// too large for a number is the largest one.
    pub fn lock_ring(&self) -> Settings {
        let scale = |value: f64, percent: f64| (value * percent.max(0.0) / 100.0).clamp(-f64::MAX, f64::MAX);
        let r = &self.lock_ring;
        let mut out = self.clone();
        out.intensity = scale(self.intensity, r.intensity_percent);
        out.kick_low_hz = scale(self.kick_low_hz, r.kick_low_hz_percent);
        out.kick_high_hz = scale(self.kick_high_hz, r.kick_high_hz_percent);
        out.kick_threshold = scale(self.kick_threshold, r.kick_threshold_percent);
        out.kick_cooldown = scale(self.kick_cooldown, r.kick_cooldown_percent);
        out
    }

    /// Values nothing can mean, brought to the nearest that can: a negative speed, kickCooldown or
    /// kickDecay counts as 0. Frequencies are clamped to cava's range where they're mapped to bands.
    fn clamped(mut self) -> Settings {
        self.speed = self.speed.max(0.0);
        self.kick_cooldown = self.kick_cooldown.max(0.0);
        self.kick_decay = self.kick_decay.max(0.0);
        self
    }
}

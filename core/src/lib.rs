//! The per-frame logic of both visualizers, built natively and to WASM (ADR 0007).
//! [`Visualizer`] is the one seam: everything goes in through it and comes out of its [`Frame`].

mod kick;
mod settings;

use kick::{KickDetector, KickSettings};
use settings::Settings;

/// cava's layout: 32 bands from 30 Hz to 14 kHz, bass first.
pub const BANDS: usize = 32;

/// Everything to draw, as of the last call.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    /// The last pushed bands, 0..1, bass first.
    pub bands: [f64; BANDS],
    /// How many Kicks have fired so far (wrapping): a new one fired when it changes.
    pub kick_count: u32,
    /// The last Kick's power, 0.5..1 by how hard the hit was next to the recent ones; 0 before any.
    pub kick_power: f64,
}

/// One visualizer instance. Every call is total: bad input is clamped or ignored, never a panic,
/// and after `new` nothing allocates but `configure`.
pub struct Visualizer {
    settings: Settings,
    kicks: KickDetector,
    frame: Frame,
}

impl Default for Visualizer {
    fn default() -> Self {
        Self::new()
    }
}

fn kick_settings(s: &Settings) -> KickSettings {
    KickSettings {
        threshold: s.kick_threshold,
        low_hz: s.kick_low_hz,
        high_hz: s.kick_high_hz,
        cooldown: s.kick_cooldown,
        speed: s.speed,
    }
}

impl Visualizer {
    /// A Visualizer on the default settings.
    pub fn new() -> Self {
        let settings = Settings::default();
        Visualizer {
            kicks: KickDetector::new(kick_settings(&settings)),
            settings,
            frame: Frame { bands: [0.0; BANDS], kick_count: 0, kick_power: 0.0 },
        }
    }

    /// The settings, as config.json's text: v0.10.0's keys, defaults and meanings. A key that's
    /// missing or of the wrong type gets its default; broken JSON is ignored, keeping the last
    /// good settings. They take effect on the next frame; the running state carries over.
    pub fn configure(&mut self, settings: &str) {
        if let Some(settings) = Settings::parse(settings) {
            self.kicks.configure(kick_settings(&settings));
            self.settings = settings;
        }
    }

    /// One capture frame: the BANDS bands, 0..1, bass first, and when they came, in real
    /// seconds. A frame with another number of bands, or at no real time, is ignored; a band
    /// outside 0..1 (or NaN, as 0) is clamped.
    pub fn push_bands(&mut self, bands: &[f64], time: f64) {
        if bands.len() != BANDS || !time.is_finite() {
            return;
        }
        let mut values = [0.0; BANDS];
        for (value, &band) in values.iter_mut().zip(bands) {
            *value = if band.is_nan() { 0.0 } else { band.clamp(0.0, 1.0) };
        }
        self.frame.bands = values;
        if let Some(power) = self.kicks.push(&values, time) {
            self.frame.kick_count = self.frame.kick_count.wrapping_add(1);
            self.frame.kick_power = power;
        }
    }

    /// Everything to draw.
    pub fn frame(&self) -> Frame {
        self.frame
    }
}

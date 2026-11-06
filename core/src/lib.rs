//! The per-frame logic of both visualizers, built natively and to WASM (ADR 0007).
//! [`Visualizer`] is the one seam: everything goes in through it and comes out of its [`Frame`].

// The C ABI is the native boundary; in WASM, wasm-bindgen's exports would clash with its names.
#[cfg(not(target_arch = "wasm32"))]
pub mod c_abi;
mod kick;
mod settings;
#[cfg(target_arch = "wasm32")]
mod wasm;

use kick::{KickDetector, KickSettings};
use settings::Settings;

/// cava's layout: 32 bands from 30 Hz to 14 kHz, bass first.
pub const BANDS: usize = 32;
/// Where `Frame::time` wraps (shell.qml's `audio.time % 1200`).
pub const TIME_WRAP: f64 = 1200.0;
/// How many Kicks play at once: a new Kick's Shockwave and Spray add to those of the last ones
/// (KICKS in shaders/viz.frag and docs/lock-ring/ring.frag).
pub const KICK_SLOTS: usize = 8;
/// An empty Kick slot's time: 100 s before the clock started, played out long ago.
const EMPTY_SLOT: f64 = -100.0;
/// Kick seeds count 1..999, then 0 and round again.
const SEEDS: u32 = 1000;
/// Where `Frame::flow` wraps: the shader only uses flow times multiples of 1/20, so every Ribbon
/// is periodic in 40π and the wrap is seamless (audio/AudioPipeline.qml).
pub const FLOW_WRAP: f64 = 40.0 * std::f64::consts::PI;

/// Everything to draw, as of the last call. Laid out as C's `VisualizerFrame`
/// (include/visualizer_core.h): change both together.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Frame {
    /// The last pushed bands, 0..1, bass first.
    pub bands: [f64; BANDS],
    /// The averages of bands 0-5, 6-15 and 16-31.
    pub bass: f64,
    pub mid: f64,
    pub treble: f64,
    /// The Kick level: 1 when a Kick fires, fading at kickDecay per second as display frames pass.
    pub kick: f64,
    /// The animation clock: display seconds times speed, wrapped at TIME_WRAP s for the shader's
    /// 32-bit floats.
    pub time: f64,
    /// The wave phase: runs at speed times 8 bass + 4 mid + 6 Kick level a second, so the Ribbons
    /// move with the music; wrapped at FLOW_WRAP, where every Ribbon repeats.
    pub flow: f64,
    /// The Kick slots, the last KICK_SLOTS Kicks, in any order: each one's age on the animation
    /// clock (unwrapped: an empty slot's is time + 100), power (0 = empty) and seed (its number,
    /// 1..999 then 0 and round again: a fresh Spray per Kick).
    pub kick_ages: [f64; KICK_SLOTS],
    pub kick_powers: [f64; KICK_SLOTS],
    pub kick_seeds: [f64; KICK_SLOTS],
    /// The intensity and bassStretch settings, as configured.
    pub intensity: f64,
    pub bass_stretch: f64,
    /// The last Kick's power, 0.5..1 by how hard the hit was next to the recent ones; 0 before any.
    pub kick_power: f64,
    /// How many Kicks have fired so far (wrapping): a new one fired when it changes.
    pub kick_count: u32,
}

/// One visualizer instance. Every call is total: bad input is clamped or ignored, never a panic,
/// and after `new` nothing allocates but `configure`.
pub struct Visualizer {
    settings: Settings,
    kicks: KickDetector,
    /// The animation clock, unwrapped: the Kick slots' ages are counted on it.
    clock: f64,
    /// When each slot's Kick fired, on the clock (-100 for none), and the last Kick's seed.
    kick_times: [f64; KICK_SLOTS],
    kick_seed: u32,
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

fn average(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len() as f64
}

impl Visualizer {
    /// A Visualizer on the default settings.
    pub fn new() -> Self {
        let settings = Settings::default();
        Visualizer {
            kicks: KickDetector::new(kick_settings(&settings)),
            clock: 0.0,
            kick_times: [EMPTY_SLOT; KICK_SLOTS],
            kick_seed: 0,
            frame: Frame {
                bands: [0.0; BANDS],
                bass: 0.0,
                mid: 0.0,
                treble: 0.0,
                kick: 0.0,
                time: 0.0,
                flow: 0.0,
                kick_ages: [-EMPTY_SLOT; KICK_SLOTS],
                kick_powers: [0.0; KICK_SLOTS],
                kick_seeds: [0.0; KICK_SLOTS],
                intensity: settings.intensity,
                bass_stretch: settings.bass_stretch,
                kick_power: 0.0,
                kick_count: 0,
            },
            settings,
        }
    }

    /// The settings, as config.json's text: v0.10.0's keys, defaults and meanings. A key that's
    /// missing or of the wrong type gets its default; broken JSON is ignored, keeping the last
    /// good settings. They take effect on the next frame; the running state carries over.
    pub fn configure(&mut self, settings: &str) {
        if let Some(settings) = Settings::parse(settings) {
            self.kicks.configure(kick_settings(&settings));
            self.frame.intensity = settings.intensity;
            self.frame.bass_stretch = settings.bass_stretch;
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
        self.frame.bass = average(&values[..6]);
        self.frame.mid = average(&values[6..16]);
        self.frame.treble = average(&values[16..]);
        if let Some(power) = self.kicks.push(&values, time) {
            self.frame.kick = 1.0;
            self.frame.kick_count = self.frame.kick_count.wrapping_add(1);
            self.frame.kick_power = power;
            self.kick_seed = (self.kick_seed + 1) % SEEDS;
            let slot = self.kick_seed as usize % KICK_SLOTS;
            self.kick_times[slot] = self.clock;
            self.frame.kick_powers[slot] = power;
            self.frame.kick_seeds[slot] = self.kick_seed as f64;
            self.frame.kick_ages[slot] = 0.0;
        }
    }

    /// One display frame, dt seconds after the last. A negative or NaN dt counts as none, an
    /// infinite one as the longest finite one.
    pub fn advance(&mut self, dt: f64) {
        let dt = if dt > 0.0 { dt.min(f64::MAX) } else { 0.0 };
        let speed = self.settings.speed;
        self.clock = (self.clock + dt * speed).min(f64::MAX);
        self.frame.time = self.clock % TIME_WRAP;
        let f = &self.frame;
        let step = dt * speed * (8.0 * f.bass + 4.0 * f.mid + 6.0 * f.kick);
        self.frame.flow = (f.flow + step).min(f64::MAX) % FLOW_WRAP;
        self.frame.kick *= libm::exp(-dt * self.settings.kick_decay);
        for (age, &at) in self.frame.kick_ages.iter_mut().zip(&self.kick_times) {
            *age = self.clock - at;
        }
    }

    /// Everything to draw.
    pub fn frame(&self) -> Frame {
        self.frame
    }

    /// Everything to draw, in place: for the boundaries, which hand it over without a copy.
    pub(crate) fn frame_ref(&self) -> &Frame {
        &self.frame
    }
}

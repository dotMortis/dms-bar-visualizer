//! The per-frame logic of both visualizers, built natively and to WASM (ADR 0007).
//! [`Visualizer`] is the one seam: everything goes in through it and comes out of its [`Frame`].

// The C ABI is the native boundary; in WASM, wasm-bindgen's exports would clash with its names.
#[cfg(not(target_arch = "wasm32"))]
pub mod c_abi;
mod kick;
pub mod lock_ring;
pub mod ribbons;
mod settings;
#[cfg(target_arch = "wasm32")]
mod wasm;

use kick::{KickDetector, KickSettings};
pub use lock_ring::LockRingFrame;
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
/// "Silent output" (audio/silence.mjs): every band below SILENCE_THRESHOLD for SILENCE_HOLD
/// seconds of display frames. Provisional; the harness refines them.
pub const SILENCE_THRESHOLD: f64 = 0.02;
pub const SILENCE_HOLD: f64 = 2.0;
/// A Kick's Shockwave has played out this many seconds after it fired, on the animation clock
/// (PLAYED_OUT in docs/lock-ring/ring.frag; viz.frag's Spray is gone at 2 s and its Shockwave
/// below e^-6.6 of its power).
pub const PLAYED_OUT: f64 = 3.0;
/// The Kick level has settled once it's below this: a tenth of a step of an 8-bit color.
pub const KICK_SETTLED: f64 = 0.001;

/// The Active Player, as the visualizer follows it (MPRIS stays outside the core).
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Player {
    /// No Active Player.
    None = 0,
    Paused = 1,
    Playing = 2,
}

/// Which visualizer a Visualizer is: the Bar Visualizer, or the Lock Ring, which runs on the bar's
/// settings with its lockRing percentages applied (ADR 0005) and keeps the Lock Ring's own state
/// (`Visualizer::lock_ring`).
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Bar = 0,
    LockRing = 1,
}

/// Which Silence case applies (GLOSSARY.md), or None when there is something to hear.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Silence {
    None = 0,
    NoPlayer = 1,
    Paused = 2,
    /// The Active Player plays, but every band has been below SILENCE_THRESHOLD for SILENCE_HOLD s.
    Silent = 3,
}

/// The band cava puts a sine at `hz` in: where kickLowHz and kickHighHz land. Below cava's 30 Hz
/// it's the first band, above its 14 kHz the last. Computes cava's layout: not for every frame.
pub fn band_at(hz: f64) -> usize {
    kick::cava_band(hz)
}

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
    /// Which Silence case applies; a new Visualizer has no player.
    pub silence: Silence,
    /// Whether anything still moves without sound: a Kick's Shockwave that hasn't played out
    /// (while the clock runs at a speed above 0), or the Kick level not yet settled. A visualizer
    /// in Silence that isn't animating may stop drawing.
    pub animating: bool,
}

/// One visualizer instance. Every call is total: bad input is clamped or ignored, never a panic,
/// and after `new` nothing allocates but `configure`.
pub struct Visualizer {
    kind: Kind,
    /// config.json's settings as configured, and the ones this kind runs on.
    config: Settings,
    settings: Settings,
    kicks: KickDetector,
    /// The animation clock, unwrapped: the Kick slots' ages are counted on it.
    clock: f64,
    /// When each slot's Kick fired, on the clock (-100 for none), and the last Kick's seed.
    kick_times: [f64; KICK_SLOTS],
    kick_seed: u32,
    player: Player,
    /// Display seconds so far, and when the output last sounded (or the player started playing).
    seconds: f64,
    sound_at: f64,
    frame: Frame,
    /// The Lock Ring's own state: stepped only while the kind is the Lock Ring.
    lock_ring: lock_ring::LockRing,
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
            kind: Kind::Bar,
            config: settings.clone(),
            kicks: KickDetector::new(kick_settings(&settings)),
            clock: 0.0,
            kick_times: [EMPTY_SLOT; KICK_SLOTS],
            kick_seed: 0,
            player: Player::None,
            seconds: 0.0,
            sound_at: 0.0,
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
                silence: Silence::NoPlayer,
                animating: false,
            },
            lock_ring: lock_ring::LockRing::default(),
            settings,
        }
    }

    /// The settings, as config.json's text: v0.10.0's keys, defaults and meanings. A key that's
    /// missing or of the wrong type gets its default; broken JSON is ignored, keeping the last
    /// good settings. They take effect on the next frame; the running state carries over.
    pub fn configure(&mut self, settings: &str) {
        if let Some(settings) = Settings::parse(settings) {
            self.config = settings;
            self.apply_settings();
        }
    }

    /// Which visualizer this is: the Bar Visualizer (as new), or the Lock Ring. Configures it as
    /// that kind on the settings last configured; the running state carries over.
    pub fn set_kind(&mut self, kind: Kind) {
        self.kind = kind;
        self.apply_settings();
    }

    fn apply_settings(&mut self) {
        let settings = match self.kind {
            Kind::Bar => self.config.clone(),
            Kind::LockRing => self.config.lock_ring(),
        };
        self.kicks.configure(kick_settings(&settings));
        self.frame.intensity = settings.intensity;
        self.frame.bass_stretch = settings.bass_stretch;
        self.settings = settings;
        self.update_lock_ring();
        self.update_animating();
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
        if values.iter().any(|&b| b >= SILENCE_THRESHOLD) {
            self.sound_at = self.seconds;
            self.update_silence();
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
            self.update_animating();
        }
        self.update_lock_ring();
    }

    /// One display frame, dt seconds after the last. A negative or NaN dt counts as none, an
    /// infinite one as the longest finite one.
    pub fn advance(&mut self, dt: f64) {
        let dt = if dt > 0.0 { dt.min(f64::MAX) } else { 0.0 };
        self.seconds = (self.seconds + dt).min(f64::MAX);
        self.update_silence();
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
        if self.kind == Kind::LockRing {
            self.lock_ring.step(&self.frame, dt, speed);
        }
        self.update_lock_ring();
        self.update_animating();
    }

    /// The Active Player: none, paused or playing. While it doesn't play, nothing is captured (as
    /// audio/AudioPipeline.qml stops cava), so the bands read as silent until the next push.
    pub fn set_player(&mut self, player: Player) {
        if player == Player::Playing && self.player != Player::Playing {
            self.sound_at = self.seconds;
        }
        if player != Player::Playing {
            let f = &mut self.frame;
            f.bands = [0.0; BANDS];
            (f.bass, f.mid, f.treble) = (0.0, 0.0, 0.0);
        }
        self.player = player;
        self.update_silence();
        self.update_lock_ring();
    }

    /// The local time of day, in seconds since local midnight, that the Lock Ring's Hands show:
    /// call it on every display frame, before reading the frame. A time past midnight lands on the
    /// time of day it is; one that isn't a number is ignored. Until the first, it is midnight.
    pub fn set_local_time(&mut self, seconds: f64) {
        self.lock_ring.set_local_time(seconds);
        self.update_lock_ring();
    }

    fn update_lock_ring(&mut self) {
        if self.kind == Kind::LockRing {
            self.lock_ring.update(&self.frame, self.settings.kick_decay, self.settings.lock_ring.hand_waves);
        }
    }

    fn update_animating(&mut self) {
        let f = &self.frame;
        let moving = self.settings.speed > 0.0;
        let in_flight = f.kick_powers.iter().zip(&f.kick_ages).any(|(&power, &age)| power > 0.0 && age < PLAYED_OUT);
        let ring_settling = self.kind == Kind::LockRing && self.lock_ring.settling();
        self.frame.animating = f.kick > KICK_SETTLED || (moving && in_flight) || ring_settling;
    }

    fn update_silence(&mut self) {
        self.frame.silence = match self.player {
            Player::None => Silence::NoPlayer,
            Player::Paused => Silence::Paused,
            Player::Playing if self.seconds - self.sound_at >= SILENCE_HOLD => Silence::Silent,
            Player::Playing => Silence::None,
        };
    }

    /// Everything to draw.
    pub fn frame(&self) -> Frame {
        self.frame
    }

    /// Everything to draw, in place: for the boundaries, which hand it over without a copy.
    pub(crate) fn frame_ref(&self) -> &Frame {
        &self.frame
    }

    /// The Lock Ring's own state, on top of the frame: its ring motion, Hands, Hour Points, Digital
    /// Time and the shader's Kick slots. Kept only while the kind is the Lock Ring.
    pub fn lock_ring(&self) -> LockRingFrame {
        self.lock_ring.frame
    }

    /// The Lock Ring's state, in place: for the boundaries.
    pub(crate) fn lock_ring_ref(&self) -> &LockRingFrame {
        &self.lock_ring.frame
    }
}

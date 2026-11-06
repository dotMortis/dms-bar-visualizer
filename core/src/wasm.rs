//! The wasm-bindgen API: what the demo calls, the same shape as the C ABI (c_abi.rs).
//!
//! ```js
//! const visualizer = new Visualizer();
//! visualizer.configure(configJsonText);
//! visualizer.setPlayer("playing");                // or "paused", "none"
//! visualizer.pushBands(float64ArrayOf32Bands, timeSeconds);
//! visualizer.advance(dtSeconds);
//! const { bands, bass, mid, treble, kick, time, flow, kickAges, kickPowers, kickSeeds,
//!         intensity, bassStretch, kickPower, kickCount, silence, animating } = visualizer.frame();
//! visualizer.free();
//! ```
//!
//! `silence` is the Silence case as audio/silence.mjs names it: "" (something to hear),
//! "no-player", "paused" or "silent"; `animating` a boolean. Like the C ABI's, `frame()` hands
//! over the Visualizer's own frame without a copy: the same object, its arrays the same
//! Float64Arrays, every call, updated in place. pushBands, advance and frame never allocate in
//! WASM memory: the bands are read straight from the caller's array. wasm32 can't unwind, so a
//! panic would trap: every call here is total by construction.

use js_sys::{Float64Array, Object, Reflect};
use wasm_bindgen::prelude::*;

use crate::{Player, Silence, Visualizer, BANDS, KICK_SLOTS};

/// The frame's number fields, in the order `numbers()` gives them.
const NUMBERS: [&str; 10] =
    ["bass", "mid", "treble", "kick", "time", "flow", "intensity", "bassStretch", "kickPower", "kickCount"];

/// A Visualizer for JS, and the frame object it hands out.
#[wasm_bindgen(js_name = Visualizer)]
pub struct WasmVisualizer {
    visualizer: Visualizer,
    frame: Object,
    bands: Float64Array,
    kick_ages: Float64Array,
    kick_powers: Float64Array,
    kick_seeds: Float64Array,
    /// The JS names of the number fields, and of silence and animating, made once.
    keys: [JsValue; NUMBERS.len()],
    silence_key: JsValue,
    animating_key: JsValue,
    /// The Silence cases' names, by Silence as u32, made once.
    silences: [JsValue; 4],
}

impl Default for WasmVisualizer {
    fn default() -> Self {
        Self::new()
    }
}

fn array(frame: &Object, key: &str, length: usize) -> Float64Array {
    let array = Float64Array::new_with_length(length as u32);
    let _ = Reflect::set(frame, &JsValue::from_str(key), &array);
    array
}

#[wasm_bindgen(js_class = Visualizer)]
impl WasmVisualizer {
    /// A Visualizer on the default settings.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmVisualizer {
        let frame = Object::new();
        WasmVisualizer {
            visualizer: Visualizer::new(),
            bands: array(&frame, "bands", BANDS),
            kick_ages: array(&frame, "kickAges", KICK_SLOTS),
            kick_powers: array(&frame, "kickPowers", KICK_SLOTS),
            kick_seeds: array(&frame, "kickSeeds", KICK_SLOTS),
            frame,
            keys: NUMBERS.map(JsValue::from_str),
            silence_key: JsValue::from_str("silence"),
            animating_key: JsValue::from_str("animating"),
            silences: ["", "no-player", "paused", "silent"].map(JsValue::from_str),
        }
    }

    /// The settings, as config.json's text. See `Visualizer::configure`.
    pub fn configure(&mut self, settings: &str) {
        self.visualizer.configure(settings);
    }

    /// The Active Player: "none", "paused" or "playing"; anything else is ignored. See
    /// `Visualizer::set_player`.
    #[wasm_bindgen(js_name = setPlayer)]
    pub fn set_player(&mut self, player: &str) {
        let player = match player {
            "none" => Player::None,
            "paused" => Player::Paused,
            "playing" => Player::Playing,
            _ => return,
        };
        self.visualizer.set_player(player);
    }

    /// One capture frame: the 32 bands, 0..1, bass first (a Float64Array; another length is
    /// ignored), and when they came, in real seconds.
    #[wasm_bindgen(js_name = pushBands)]
    pub fn push_bands(&mut self, bands: &Float64Array, time: f64) {
        if bands.length() as usize != BANDS {
            return;
        }
        let mut values = [0.0; BANDS];
        bands.copy_to(&mut values);
        self.visualizer.push_bands(&values, time);
    }

    /// One display frame, dt seconds after the last.
    pub fn advance(&mut self, dt: f64) {
        self.visualizer.advance(dt);
    }

    /// Everything to draw: the same object every call, updated in place.
    pub fn frame(&self) -> Object {
        let f = self.visualizer.frame_ref();
        self.bands.copy_from(&f.bands);
        self.kick_ages.copy_from(&f.kick_ages);
        self.kick_powers.copy_from(&f.kick_powers);
        self.kick_seeds.copy_from(&f.kick_seeds);
        let numbers = [
            f.bass,
            f.mid,
            f.treble,
            f.kick,
            f.time,
            f.flow,
            f.intensity,
            f.bass_stretch,
            f.kick_power,
            f.kick_count as f64,
        ];
        for (key, value) in self.keys.iter().zip(numbers) {
            let _ = Reflect::set(&self.frame, key, &JsValue::from_f64(value));
        }
        let silence = &self.silences[match f.silence {
            Silence::None => 0,
            Silence::NoPlayer => 1,
            Silence::Paused => 2,
            Silence::Silent => 3,
        }];
        let _ = Reflect::set(&self.frame, &self.silence_key, silence);
        let _ = Reflect::set(&self.frame, &self.animating_key, &JsValue::from_bool(f.animating));
        self.frame.clone()
    }
}

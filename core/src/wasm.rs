//! The wasm-bindgen API: what the demo calls, the same shape as the C ABI (c_abi.rs).
//!
//! ```js
//! const visualizer = new Visualizer();
//! visualizer.configure(configJsonText);
//! visualizer.pushBands(float64ArrayOf32Bands, timeSeconds);
//! visualizer.advance(dtSeconds);
//! const { bands, bass, mid, treble, kick, kickPower, kickCount } = visualizer.frame();
//! visualizer.free();
//! ```
//!
//! Like the C ABI's, `frame()` hands over the Visualizer's own frame without a copy: the same
//! object, its `bands` the same Float64Array, every call, updated in place. pushBands, advance and
//! frame never allocate in WASM memory: the bands are read straight from the caller's array.
//! wasm32 can't unwind, so a panic would trap: every call here is total by construction.

use js_sys::{Float64Array, Object, Reflect};
use wasm_bindgen::prelude::*;

use crate::{Visualizer, BANDS};

/// A Visualizer for JS, and the frame object it hands out.
#[wasm_bindgen(js_name = Visualizer)]
pub struct WasmVisualizer {
    visualizer: Visualizer,
    frame: Object,
    bands: Float64Array,
    /// The frame's number fields: their JS names, made once.
    keys: [JsValue; 6],
}

impl Default for WasmVisualizer {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen(js_class = Visualizer)]
impl WasmVisualizer {
    /// A Visualizer on the default settings.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmVisualizer {
        let frame = Object::new();
        let bands = Float64Array::new_with_length(BANDS as u32);
        let _ = Reflect::set(&frame, &JsValue::from_str("bands"), &bands);
        let keys = ["bass", "mid", "treble", "kick", "kickPower", "kickCount"].map(JsValue::from_str);
        WasmVisualizer { visualizer: Visualizer::new(), frame, bands, keys }
    }

    /// The settings, as config.json's text. See `Visualizer::configure`.
    pub fn configure(&mut self, settings: &str) {
        self.visualizer.configure(settings);
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
        let frame = self.visualizer.frame_ref();
        self.bands.copy_from(&frame.bands);
        let values = [frame.bass, frame.mid, frame.treble, frame.kick, frame.kick_power, frame.kick_count as f64];
        for (key, value) in self.keys.iter().zip(values) {
            let _ = Reflect::set(&self.frame, key, &JsValue::from_f64(value));
        }
        self.frame.clone()
    }
}

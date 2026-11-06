//! The C ABI: what the thin C++ QML module of specs D and E calls (ADR 0008), declared for C in
//! include/visualizer_core.h. One `Visualizer` per visualizer instance, behind an opaque pointer.
//!
//! Every call is total. A null Visualizer, a null or short buffer, or text that isn't UTF-8 is
//! ignored, and a panic, should one ever happen, is caught here instead of unwinding into the
//! caller (which would abort DMS). push_bands, advance, set_player and frame never allocate,
//! nor do set_kind, set_local_time and lock_ring.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::ptr;

use crate::{Frame, Kind, LockRingFrame, Player, Visualizer};

/// Runs `body`, or gives `fallback` if it panics.
fn guarded<T>(fallback: T, body: impl FnOnce() -> T) -> T {
    catch_unwind(AssertUnwindSafe(body)).unwrap_or(fallback)
}

/// A new Visualizer on the default settings, for `visualizer_destroy` to free; null only if it
/// couldn't be made.
#[no_mangle]
pub extern "C" fn visualizer_create() -> *mut Visualizer {
    guarded(ptr::null_mut(), || Box::into_raw(Box::new(Visualizer::new())))
}

/// Frees a Visualizer from `visualizer_create`. Null is ignored.
///
/// # Safety
/// `visualizer` is null or from `visualizer_create`, and not used again.
#[no_mangle]
pub unsafe extern "C" fn visualizer_destroy(visualizer: *mut Visualizer) {
    if !visualizer.is_null() {
        guarded((), || drop(Box::from_raw(visualizer)));
    }
}

/// The settings, as config.json's text: `len` bytes of UTF-8 at `json`, no terminator needed.
/// See `Visualizer::configure`.
///
/// # Safety
/// `visualizer` is null or live; `json` is null or points to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn visualizer_configure(visualizer: *mut Visualizer, json: *const u8, len: usize) {
    let (Some(visualizer), false) = (visualizer.as_mut(), json.is_null()) else { return };
    let bytes = std::slice::from_raw_parts(json, len);
    if let Ok(text) = std::str::from_utf8(bytes) {
        guarded((), || visualizer.configure(text));
    }
}

/// One capture frame: `count` bands at `bands`, and when they came, in real seconds. See
/// `Visualizer::push_bands`.
///
/// # Safety
/// `visualizer` is null or live; `bands` is null or points to `count` readable doubles.
#[no_mangle]
pub unsafe extern "C" fn visualizer_push_bands(
    visualizer: *mut Visualizer,
    bands: *const f64,
    count: usize,
    time: f64,
) {
    let (Some(visualizer), false) = (visualizer.as_mut(), bands.is_null()) else { return };
    let bands = std::slice::from_raw_parts(bands, count);
    guarded((), || visualizer.push_bands(bands, time));
}

/// One display frame, `dt` seconds after the last. See `Visualizer::advance`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_advance(visualizer: *mut Visualizer, dt: f64) {
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.advance(dt));
    }
}

/// The Active Player: 0 none, 1 paused, 2 playing (VISUALIZER_PLAYER_*); any other value is
/// ignored. See `Visualizer::set_player`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_player(visualizer: *mut Visualizer, player: u32) {
    let player = match player {
        0 => Player::None,
        1 => Player::Paused,
        2 => Player::Playing,
        _ => return,
    };
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_player(player));
    }
}

/// Which visualizer this is: 0 the Bar Visualizer (as created), 1 the Lock Ring (VISUALIZER_KIND_*);
/// any other value is ignored. See `Visualizer::set_kind`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_kind(visualizer: *mut Visualizer, kind: u32) {
    let kind = match kind {
        0 => Kind::Bar,
        1 => Kind::LockRing,
        _ => return,
    };
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_kind(kind));
    }
}

/// The local time of day the Lock Ring's Hands show, in seconds since local midnight. See
/// `Visualizer::set_local_time`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_local_time(visualizer: *mut Visualizer, seconds: f64) {
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_local_time(seconds));
    }
}

/// The Lock Ring's state, owned by the Visualizer: valid until the next call on it. Null for a null
/// Visualizer. See `Visualizer::lock_ring`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_lock_ring(visualizer: *const Visualizer) -> *const LockRingFrame {
    match visualizer.as_ref() {
        Some(visualizer) => visualizer.lock_ring_ref(),
        None => ptr::null(),
    }
}

/// Everything to draw, owned by the Visualizer: valid until the next call on it. Null for a null
/// Visualizer.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_frame(visualizer: *const Visualizer) -> *const Frame {
    match visualizer.as_ref() {
        Some(visualizer) => visualizer.frame_ref(),
        None => ptr::null(),
    }
}

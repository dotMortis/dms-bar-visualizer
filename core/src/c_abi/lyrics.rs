//! The C ABI of the Lyric Words (bar_lyrics.rs): the Active Player's track, lyrics and playback
//! position in, glyph instances out. Total like the rest: a null Visualizer or buffer, or text
//! that isn't UTF-8, is ignored. set_position, set_bar_size, set_ring_size and glyphs never allocate.

use std::ptr;

use super::guarded;
use crate::{Glyph, Visualizer};

/// `len` bytes at `text` as UTF-8, if they are.
unsafe fn text<'a>(text: *const u8, len: usize) -> Option<&'a str> {
    if text.is_null() {
        return None;
    }
    std::str::from_utf8(std::slice::from_raw_parts(text, len)).ok()
}

/// Seeds where the Lyric Words land. See `Visualizer::set_seed`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_seed(visualizer: *mut Visualizer, seed: u32) {
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_seed(seed));
    }
}

/// The Active Player's track: `len` bytes of UTF-8 at `id`, any identity, and its length in
/// seconds (0: unknown). See `Visualizer::set_track`.
///
/// # Safety
/// `visualizer` is null or live; `id` is null or points to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_track(visualizer: *mut Visualizer, id: *const u8, len: usize, length: f64) {
    if let (Some(visualizer), Some(id)) = (visualizer.as_mut(), text(id, len)) {
        guarded((), || visualizer.set_track(id, length));
    }
}

/// The track's lyrics: `len` bytes of UTF-8 JSON at `json`, DMS's lyrics. See
/// `Visualizer::set_lyrics`.
///
/// # Safety
/// `visualizer` is null or live; `json` is null or points to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_lyrics(visualizer: *mut Visualizer, json: *const u8, len: usize) {
    if let (Some(visualizer), Some(json)) = (visualizer.as_mut(), text(json, len)) {
        guarded((), || visualizer.set_lyrics(json));
    }
}

/// A playback position reading, now: the song time in seconds and the playback rate. See
/// `Visualizer::set_position`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_position(visualizer: *mut Visualizer, time: f64, rate: f64) {
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_position(time, rate));
    }
}

/// The bar's size in pixels. See `Visualizer::set_bar_size`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_bar_size(visualizer: *mut Visualizer, width: f64, height: f64) {
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_bar_size(width, height));
    }
}

/// The Lock Ring's side in pixels. See `Visualizer::set_ring_size`.
///
/// # Safety
/// `visualizer` is null or live.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_ring_size(visualizer: *mut Visualizer, side: f64) {
    if let Some(visualizer) = visualizer.as_mut() {
        guarded((), || visualizer.set_ring_size(side));
    }
}

/// The font's measures, in ems: `len` bytes of UTF-8 at `letters`, `count` advances at
/// `advances`, one per letter in order, and the line height. See `Visualizer::set_letters`.
///
/// # Safety
/// `visualizer` is null or live; `letters` is null or points to `len` readable bytes; `advances`
/// is null or points to `count` readable doubles.
#[no_mangle]
pub unsafe extern "C" fn visualizer_set_letters(
    visualizer: *mut Visualizer,
    letters: *const u8,
    len: usize,
    advances: *const f64,
    count: usize,
    line_height: f64,
) {
    let (Some(visualizer), Some(letters), false) = (visualizer.as_mut(), text(letters, len), advances.is_null()) else {
        return;
    };
    let advances = std::slice::from_raw_parts(advances, count);
    guarded((), || visualizer.set_letters(letters, advances, line_height));
}

/// The Lyric Words shown, as glyph instances, owned by the Visualizer: `*count` of them, valid
/// until the next call on it. Null, with `*count` 0, when there are none; null for a null
/// Visualizer or `count`.
///
/// # Safety
/// `visualizer` is null or live; `count` is null or points to a writable size_t.
#[no_mangle]
pub unsafe extern "C" fn visualizer_glyphs(visualizer: *const Visualizer, count: *mut usize) -> *const Glyph {
    let Some(count) = count.as_mut() else { return ptr::null() };
    let glyphs = visualizer.as_ref().map_or(&[][..], |v| v.glyphs());
    *count = glyphs.len();
    if glyphs.is_empty() {
        ptr::null()
    } else {
        glyphs.as_ptr()
    }
}

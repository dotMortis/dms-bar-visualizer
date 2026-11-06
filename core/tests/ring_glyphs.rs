// The Lock Ring's Lyric Words as the core hands them over for drawing: glyph instances through the
// same glyphs() as the bar's, one per letter of every word shown, with all the drawing needs
// (LockRing.qml's per-letter and per-word values in v0.10.0), around the dial's center. Letter
// advances come in as data, in ems; the core loads no fonts.
use serde_json::json;
use visualizer_core::lock_ring::*;
use visualizer_core::{Glyph, Kind, LyricWord, Player, Visualizer, BANDS};

/// The ring's side, px: the dial's radius is DIAL_RATIO of it, a lead vocal's em WORD_FONT (12 px).
const SIDE: f64 = 500.0;
/// 10:10 local time, in seconds since midnight.
const TEN_TEN: f64 = 36600.0;

fn near(actual: f64, expected: f64, msg: &str) {
    assert!((actual - expected).abs() < 1e-9, "{msg} {actual} != {expected}");
}

/// A Lock Ring on a SIDE px square playing `synced` from song time 10, with `seed`.
fn ring_with(synced: serde_json::Value, seed: u32) -> Visualizer {
    let mut v = Visualizer::new();
    v.set_kind(Kind::LockRing);
    v.set_seed(seed);
    v.set_ring_size(SIDE);
    v.set_local_time(TEN_TEN);
    // "h", "i" and "e" half an em wide, "y" 0.6, "o" 0.55; the rest not given.
    v.set_letters("hiyoe", &[0.5, 0.5, 0.6, 0.55, 0.5], 1.25);
    v.set_track("track-1", 300.0);
    v.set_lyrics(&json!({ "state": "ready", "synced": synced }).to_string());
    v.set_player(Player::Playing);
    v.set_position(10.0, 1.0);
    v
}

/// "hi you" from song time 10 to 14.
fn ring() -> Visualizer {
    ring_with(json!([{ "t": 10, "e": 14, "x": "hi you" }]), 1)
}

fn letters(glyphs: &[Glyph]) -> String {
    glyphs.iter().map(|g| char::from_u32(g.letter as u32).unwrap()).collect()
}

/// The scene the core places the words in, from what it hands out: its frame and Lock Ring state.
fn scene(v: &Visualizer) -> (visualizer_core::Frame, LockRingFrame) {
    (v.frame(), v.lock_ring())
}

fn word_scene<'a>(f: &'a visualizer_core::Frame, r: &LockRingFrame) -> WordScene<'a> {
    WordScene::of_frame(f, r, hand_poses(TEN_TEN, r.hand_levels, r.hand_flash, 1.0), SIDE)
}

/// The glyphs of word `index`.
fn of_word(glyphs: &[Glyph], index: usize) -> Vec<Glyph> {
    glyphs.iter().filter(|g| g.word == index as f64).copied().collect()
}

#[test]
fn every_letter_of_every_word_shown_is_a_glyph() {
    let mut v = ring();
    v.advance(0.0);
    assert!(v.glyphs().is_empty(), "nothing shown yet");
    v.advance(3.0);
    assert_eq!(letters(v.glyphs()), "hiyou");
    let words: Vec<f64> = v.glyphs().iter().map(|g| g.word).collect();
    assert_eq!(words, [0.0, 0.0, 1.0, 1.0, 1.0], "each glyph says which word of lyric_words() it is");
}

#[test]
fn the_letters_sit_where_word_placement_puts_them_at_the_rings_em() {
    let mut v = ring();
    v.advance(3.0);
    let (f, r) = scene(&v);
    let s = word_scene(&f, &r);
    for (index, word) in v.lyric_words().iter().enumerate() {
        let glyphs = of_word(v.glyphs(), index);
        let em = SIDE * WORD_FONT;
        let advances: Vec<f64> = match v.word_text(word) {
            "hi" => vec![0.5 * em, 0.5 * em],
            "you" => vec![0.6 * em, 0.55 * em, 0.5 * em],
            text => panic!("{text}"),
        };
        let mut placed = vec![PlacedLetter::default(); advances.len()];
        let p = word_placement(word.spot, &advances, &s, &mut placed);
        for (g, e) in glyphs.iter().zip(&placed) {
            assert_eq!(g.em, em);
            near(g.x, e.x, "x from the dial's center");
            near(g.y, e.y, "y, down");
            near(g.angle, e.rotation, "angle");
            near(g.pivot_x, p.x, "pivot x: the word's middle");
            near(g.pivot_y, p.y, "pivot y");
        }
    }
}

#[test]
fn each_glyph_carries_its_words_look_color_and_glow() {
    let mut v = ring();
    v.advance(0.1);
    let (f, r) = scene(&v);
    let s = word_scene(&f, &r);
    let word: LyricWord = v.lyric_words()[0];
    let em = SIDE * WORD_FONT;
    let mut placed = vec![PlacedLetter::default(); 2];
    let p = word_placement(word.spot, &[0.5 * em, 0.5 * em], &s, &mut placed);
    let look =
        word_look(&word, shockwave_crossing(p.radius, &f.kick_ages, &f.kick_powers, &f.kick_seeds, Some(p.theta)));
    let first = v.glyphs()[0];
    near(first.scale, look.scale, "scale");
    near(first.opacity, look.opacity.min(1.0), "opacity");
    near(first.glow, 1.0, "glow: a full one");
    near(first.glow_spread, look.hit.glow_scale + WORD_LOOK_GLOW_SPREAD, "glow spread");
    near(first.blur, look.blur, "blur");
    near(first.white, look.white, "white");
    near(first.glow_radius, WORD_LOOK_GLOW_RADIUS * em, "glow radius");
    near(first.copy_blur, TIME_HIT_SOFTEN * em, "the copies' blur");
    // The glow in the word's color, toward the Shockwave's glow as one crosses it; the bright core
    // that color most of the way to white, all the way in a flash.
    let glow = [0xe6 as f64 / 255.0, 0xeb as f64 / 255.0, 1.0];
    let tint = look.hit.glow_opacity * 0.6;
    let whiten = WORD_LOOK_CORE + (1.0 - WORD_LOOK_CORE) * look.white;
    #[allow(clippy::needless_range_loop)]
    for c in 0..3 {
        near(first.color[c], p.color[c] + (glow[c] - p.color[c]) * tint, "color");
        near(first.core[c], p.color[c] + (1.0 - p.color[c]) * whiten, "core");
    }
    assert!(look.white > 0.0, "still popping in");
    assert_eq!(v.glyphs()[1].scale, first.scale, "every letter of a word looks the same");
}

#[test]
fn a_shockwave_splits_the_glyphs_outward_from_the_dials_center() {
    let mut v = ring();
    v.advance(3.0);
    // A Kick, as the core's detector finds one: a capture frame rising from silence.
    v.push_bands(&[0.05; BANDS], 0.0);
    let mut hit = false;
    for _ in 0..120 {
        v.advance(1.0 / 60.0);
        if v.glyphs().iter().any(|g| g.copies[0].opacity > 0.01) {
            hit = true;
            break;
        }
    }
    assert!(hit, "a front crosses a word within two seconds");
    let g = *v.glyphs().iter().find(|g| g.copies[0].opacity > 0.01).unwrap();
    let out = g.pivot_x.hypot(g.pivot_y).max(1.0);
    let (ox, oy) = (g.pivot_x / out, g.pivot_y / out);
    let k = g.copies[0].dx / (ox * TIME_HIT_SPLIT[0] * g.em);
    for (i, copy) in g.copies.iter().enumerate() {
        near(copy.dx, ox * TIME_HIT_SPLIT[i] * k * g.em, "dx outward");
        near(copy.dy, oy * TIME_HIT_SPLIT[i] * k * g.em, "dy outward");
        near(copy.opacity, TIME_HIT_OPACITY * k, "opacity, under the glyph's own");
    }
    near(g.copies[1].color[0], 0xcb as f64 / 255.0, "mauve, the Digital Time's second copy");
}

#[test]
fn a_background_vocal_is_smaller_down_to_the_smallest_em() {
    let mut v = ring_with(json!([{ "t": 10, "e": 14, "x": "oh", "background": true }]), 1);
    v.set_ring_size(100.0);
    v.advance(1.0);
    assert!(v.glyphs().iter().all(|g| g.em == WORD_FONT_MIN), "{:?}", v.glyphs()[0].em);
}

#[test]
fn no_glyphs_without_a_ring_or_once_the_words_are_gone() {
    let mut v = ring();
    v.set_ring_size(0.0);
    v.advance(3.0);
    assert!(v.glyphs().is_empty(), "no ring");
    v.set_ring_size(SIDE);
    v.advance(0.0);
    assert!(!v.glyphs().is_empty());
    v.advance(2.0);
    assert!(v.glyphs().is_empty(), "the line has dissolved");
}

#[test]
fn the_bars_size_doesnt_lay_out_the_ring_nor_the_rings_the_bar() {
    let mut v = ring();
    v.set_ring_size(0.0);
    v.set_bar_size(800.0, 40.0);
    v.advance(3.0);
    assert!(v.glyphs().is_empty());
}

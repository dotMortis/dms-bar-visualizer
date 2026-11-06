// The Lyric Words as the core hands them over for drawing: glyph instances, one per letter of every
// word shown, with all the drawing needs (lyrics/LyricWordsLayer.qml's per-letter and per-word
// values in v0.10.0). Letter advances come in as data, in ems; the core loads no fonts.
use serde_json::json;
use visualizer_core::bar_words::{lay_word, word_look, RowWidths};
use visualizer_core::ribbons::{ribbon_color, shockwave_crossing, RibbonInputs};
use visualizer_core::{Glyph, Player, Visualizer, BANDS};

fn near(actual: f64, expected: f64, msg: &str) {
    assert!((actual - expected).abs() < 1e-9, "{msg} {actual} != {expected}");
}

/// An 800 x 40 bar playing one line, "hi you" from song time 10 to 14, its letters a known width.
fn bar() -> Visualizer {
    let mut v = Visualizer::new();
    v.set_bar_size(800.0, 40.0);
    // "h" and "i" half an em wide, "y" 0.6, "o" 0.55; "u" not given. Lines 1.25 ems high.
    v.set_letters("hiyo", &[0.5, 0.5, 0.6, 0.55], 1.25);
    v.set_track("track-1", 300.0);
    v.set_lyrics(&json!({ "state": "ready", "synced": [{ "t": 10, "e": 14, "x": "hi you" }] }).to_string());
    v.set_player(Player::Playing);
    v.set_position(10.0, 1.0);
    v
}

fn letters(glyphs: &[Glyph]) -> String {
    glyphs.iter().map(|g| char::from_u32(g.letter as u32).unwrap()).collect()
}

#[test]
fn every_letter_of_every_word_shown_is_a_glyph() {
    let mut v = bar();
    v.advance(0.0);
    // At 10 the first word has only just started: not yet visible.
    assert!(v.glyphs().is_empty(), "{:?}", v.glyphs());
    v.advance(3.0);
    assert_eq!(letters(v.glyphs()), "hiyou");
    let words: Vec<f64> = v.glyphs().iter().map(|g| g.word).collect();
    assert_eq!(words, [0.0, 0.0, 1.0, 1.0, 1.0], "each glyph says which word of lyric_words() it is");
}

#[test]
fn the_letters_sit_as_lay_word_puts_them_at_the_bars_em() {
    let mut v = bar();
    v.advance(3.0);
    // The em: 0.8 of the 40 px bar, 32 px; the row "hi you": 0.5 + 0.5 + 1.2 (the gap) + 0.6 +
    // 0.55 + 0.5 (the fallback for a letter not given) ems.
    let glyphs = v.glyphs();
    assert!(glyphs.iter().all(|g| g.em == 32.0));
    let row = RowWidths { width: 3.85 * 32.0, before: 0.0 };
    let word = v.lyric_words()[0];
    let frame = v.frame();
    let inputs = RibbonInputs {
        width: 800.0,
        height: 40.0,
        bands: &frame.bands,
        time: frame.time,
        kick: frame.kick,
        treble: frame.treble,
        flow: frame.flow,
        bass_stretch: frame.bass_stretch,
        kick_ages: &frame.kick_ages,
        kick_powers: &frame.kick_powers,
    };
    let clearance = 1.25 * 32.0 * 0.32;
    let expected: Vec<_> = lay_word(word.ribbon, word.x, &[16.0, 16.0], &inputs, clearance, Some(row)).collect();
    for (g, e) in glyphs.iter().zip(&expected) {
        near(g.x, e.x, "x");
        near(g.y, e.y, "y");
        near(g.angle, e.angle, "angle");
    }
    near(glyphs[1].x - glyphs[0].x, 16.0, "side by side:");
    near(glyphs[2].x - glyphs[1].x, 8.0 + 1.2 * 32.0 + 9.6, "the next word after the gap:");
}

#[test]
fn each_glyph_carries_its_words_look_color_and_pivot() {
    let mut v = bar();
    v.advance(0.1);
    let (glyphs, words, frame) = (v.glyphs(), v.lyric_words(), v.frame());
    let word = words[0];
    let inputs = RibbonInputs {
        width: 800.0,
        height: 40.0,
        bands: &frame.bands,
        time: frame.time,
        kick: frame.kick,
        treble: frame.treble,
        flow: frame.flow,
        bass_stretch: frame.bass_stretch,
        kick_ages: &frame.kick_ages,
        kick_powers: &frame.kick_powers,
    };
    let first = glyphs[0];
    // The word's middle, between its first and last letters, is what it scales around and where
    // its color and Shockwave crossing are taken.
    let middle = (glyphs[0].x + glyphs[1].x) / 2.0;
    near(first.pivot_x, middle, "pivot x");
    near(first.pivot_y, (glyphs[0].y + glyphs[1].y) / 2.0, "pivot y");
    let look = word_look(&word, shockwave_crossing(middle, &inputs));
    let color = ribbon_color(middle, word.ribbon, &inputs);
    near(first.scale, look.scale, "scale");
    near(first.opacity, look.opacity.min(1.0), "opacity");
    near(first.glow, look.glow, "glow");
    near(first.glow_spread, 1.0 + 0.06 * (look.glow - 0.5).max(0.0), "glow spread");
    near(first.blur, look.blur, "blur");
    near(first.white, look.white, "white");
    // The bright core: the Ribbon's color, most of the way to white, all the way in a flash.
    let whiten = 0.55 + 0.45 * look.white;
    for (c, &rgb) in color.iter().enumerate() {
        near(first.color[c], rgb, "color");
        near(first.core[c], rgb + (1.0 - rgb) * whiten, "core");
    }
    assert!(look.white > 0.0, "still popping in");
    assert_eq!(glyphs[1].scale, first.scale, "every letter of a word looks the same");
}

#[test]
fn a_shockwave_splits_the_glyphs_outward_away_from_the_bars_center() {
    let mut v = bar();
    v.advance(3.0);
    // A Kick, as the core's detector finds one: a capture frame rising from silence.
    v.push_bands(&[0.05; BANDS], 0.0);
    // Its front reaches the word within a second, wherever across the bar it landed.
    for _ in 0..60 {
        v.advance(1.0 / 60.0);
        if v.glyphs()[0].copies[0].opacity > 0.01 {
            break;
        }
    }
    let glyphs = v.glyphs();
    let outward = if glyphs[0].pivot_x < 400.0 { -1.0 } else { 1.0 };
    let hit = glyphs[0].copies;
    assert!(hit.iter().all(|c| c.opacity > 0.0), "{hit:?}");
    assert!(hit.iter().all(|c| c.dx * outward > 0.0), "outward: {hit:?}");
    // Each copy pushed its share of the em (32 px) times the crossing, in the Shockwave's colors.
    let crossing = hit[0].dx * outward / (0.7 * 32.0);
    near(hit[1].dx * outward, 0.48 * 32.0 * crossing, "second copy");
    near(hit[0].color[0], 180.0 / 255.0, "lavender");
}

#[test]
fn no_glyphs_without_a_bar_or_once_the_words_are_gone() {
    let mut v = bar();
    v.set_bar_size(0.0, 0.0);
    v.advance(3.0);
    assert!(v.glyphs().is_empty(), "no bar");
    v.set_bar_size(800.0, 40.0);
    v.advance(0.0);
    assert!(!v.glyphs().is_empty());
    v.advance(10.0);
    assert!(v.glyphs().is_empty(), "the line has dissolved");
}

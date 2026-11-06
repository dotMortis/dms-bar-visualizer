//! Lyric Words on the Bar Visualizer, apart from drawing: where each letter of a word sits as it
//! rides its Ribbon, and how the word looks as it pops in, takes a Shockwave and dissolves. Ported
//! from docs/bar-words.mjs (v0.10.0). Which words show, where they land and how far their pop-in
//! and dissolve have got is lyric_line.rs's; the Ribbons' shape, color and Shockwaves are
//! ribbons.rs's.

use crate::lyric_line::{is_space, LyricWord};
use crate::ribbons::{ribbon_height, RibbonInputs};

// The look of a word:
/// Its letters' pixel size, as a share of the bar's thickness (at least LOOK_MIN_FONT px).
pub const LOOK_FONT: f64 = 0.8;
pub const LOOK_MIN_FONT: f64 = 8.0;
/// How oversized it pops in, at full pop (lyric_line.rs POP_BASE..1).
pub const LOOK_GROW: f64 = 0.5;
/// How far toward white it flashes as it pops in, at full pop.
pub const LOOK_FLASH: f64 = 0.9;
/// Its glow in its Ribbon's color: LOOK_GLOW always, LOOK_GLOW_POP more as it pops in, at full
/// pop, LOOK_GLOW_HIT more at a full Shockwave crossing.
pub const LOOK_GLOW: f64 = 0.85;
pub const LOOK_GLOW_POP: f64 = 0.6;
pub const LOOK_GLOW_HIT: f64 = 0.9;
/// A Shockwave crossing it: how far it flares toward white, how much it swells, and its copies'
/// colors (the Shockwave's own, as viz.frag's front: lavender, mauve, blue) and how far each is
/// pushed outward, in its letters' size, at LOOK_HIT_OPACITY. Like the Lock Ring's Digital Time.
pub const LOOK_HIT_WHITE: f64 = 0.9;
pub const LOOK_HIT_GROW: f64 = 0.18;
pub const LOOK_SPLIT: [([f64; 3], f64); 3] = [
    ([180.0 / 255.0, 190.0 / 255.0, 254.0 / 255.0], 0.7),
    ([203.0 / 255.0, 166.0 / 255.0, 247.0 / 255.0], 0.48),
    ([137.0 / 255.0, 180.0 / 255.0, 250.0 / 255.0], 0.26),
];
pub const LOOK_HIT_OPACITY: f64 = 0.9;
/// How much it swells as it dissolves; it blurs out too.
pub const LOOK_DISSOLVE_GROW: f64 = 0.25;
/// The gap between the words of a row, in ems (its letters' size).
pub const LOOK_SPACE: f64 = 1.2;
/// How it rides its Ribbon's wave: how much of the Ribbon's rise and fall (from the bar's middle)
/// a letter follows, and its tilt with it; and how far a letter may stray from the bar's middle at
/// most, as a share of the bar's thickness.
pub const LOOK_FOLLOW: f64 = 0.5;
pub const LOOK_REACH: f64 = 0.22;

/// Pixels either side of a letter its tilt is measured over.
const SLOPE_SPAN: f64 = 1.0;

/// The letters' size, in pixels, on a bar `height` pixels thick: LOOK_FONT of it, rounded as JS
/// rounds, at least LOOK_MIN_FONT.
pub fn em(height: f64) -> f64 {
    libm::floor(height * LOOK_FONT + 0.5).max(LOOK_MIN_FONT)
}

/// A row's widths, in pixels: all of it, and its text before a word.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RowWidths {
    pub width: f64,
    pub before: f64,
}

/// The widths of a row of text `row` and of its text `before` a word, in pixels: `measure` gives a
/// letter's width, `em` the letters' size; each space between words is LOOK_SPACE ems wide instead
/// of the font's own.
pub fn row_widths(row: &str, before: &str, measure: impl Fn(char) -> f64, em: f64) -> RowWidths {
    let width = |text: &str| text.chars().map(|c| if is_space(c) { LOOK_SPACE * em } else { measure(c) }).sum();
    RowWidths { width: width(row), before: width(before) }
}

/// Where a letter sits: its middle in pixels from the bar's top left, tilted `angle` degrees
/// clockwise.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Letter {
    pub x: f64,
    pub y: f64,
    pub angle: f64,
}

/// Where each letter of a word on `ribbon` at `x` (0, flush with the bar's left edge, .. 1, flush
/// with its right) sits. `advances` are the letters' widths in pixels; each letter rides its
/// Ribbon's wave and tilts with it, damped toward the bar's middle (LOOK_FOLLOW). `clearance` is
/// how far (pixels) a letter's middle stays from the bar's top and bottom edges: on a crest that
/// leaves the bar, or past LOOK_REACH, a letter stops there, upright. For a word in a row, `row`
/// gives the row's widths: then the whole row lies across the bar from x = 0 to 1 instead, and the
/// word sits in it; a row wider than the bar starts at its left edge.
pub fn lay_word<'a>(
    ribbon: usize,
    x: f64,
    advances: &'a [f64],
    inputs: &'a RibbonInputs<'a>,
    clearance: f64,
    row: Option<RowWidths>,
) -> impl Iterator<Item = Letter> + 'a {
    let height = inputs.height;
    let width = match row {
        Some(row) => row.width,
        None => advances.iter().sum(),
    };
    let x = if x.is_nan() { 0.0 } else { x.clamp(0.0, 1.0) };
    let mut left = (inputs.width - width).max(0.0) * x + row.map_or(0.0, |r| r.before);
    // The Ribbon's height at `at`, damped toward the bar's middle.
    let along = move |at: f64| height / 2.0 + LOOK_FOLLOW * (ribbon_height(at, ribbon, inputs) * height - height / 2.0);
    let lo = clearance.min(height / 2.0).max(height / 2.0 - LOOK_REACH * height);
    let hi = height - lo;
    advances.iter().map(move |&advance| {
        let x = left + advance / 2.0;
        left += advance;
        let y = along(x);
        if y < lo || y > hi {
            return Letter { x, y: if y < lo { lo } else { hi }, angle: 0.0 };
        }
        let rise = along(x + SLOPE_SPAN) - along(x - SLOPE_SPAN);
        Letter { x, y, angle: libm::atan2(rise, 2.0 * SLOPE_SPAN) * 180.0 / std::f64::consts::PI }
    })
}

/// One of a word's split copies: its color (r, g, b 0..1), how far it's pushed outward (in its
/// letters' size) and its opacity.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Copy {
    pub color: [f64; 3],
    pub offset: f64,
    pub opacity: f64,
}

/// How a word looks: its size (1 = a settled lead vocal's), opacity (0..1), how far toward white
/// it is (0..1: its pop-in flash or a Shockwave's flare), how bright its glow is in its Ribbon's
/// color, how blurred (0..1, as it dissolves), and its split copies.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Look {
    pub scale: f64,
    pub opacity: f64,
    pub white: f64,
    pub glow: f64,
    pub blur: f64,
    pub copies: [Copy; 3],
}

fn unit(x: f64) -> f64 {
    if x.is_nan() {
        0.0
    } else {
        x.clamp(0.0, 1.0)
    }
}

/// How a word looks with a Shockwave `crossing` it (ribbons.rs shockwave_crossing(), 0..1).
pub fn word_look(word: &LyricWord, crossing: f64) -> Look {
    let hit = unit(crossing);
    let popping = 1.0 - unit(word.pop_in);
    let dissolve = unit(word.dissolve);
    let opacity = word.brightness * (word.pop_in * 4.0).min(1.0) * (1.0 - dissolve);
    let scale = word.size
        * (1.0 + LOOK_GROW * word.pop * popping * popping)
        * (1.0 + LOOK_HIT_GROW * hit)
        * (1.0 + LOOK_DISSOLVE_GROW * dissolve);
    Look {
        scale,
        opacity,
        white: (LOOK_FLASH * word.pop * popping).max(LOOK_HIT_WHITE * hit),
        glow: LOOK_GLOW + LOOK_GLOW_POP * word.pop * popping + LOOK_GLOW_HIT * hit,
        blur: dissolve,
        copies: LOOK_SPLIT.map(|(color, offset)| Copy {
            color,
            offset: offset * hit,
            opacity: LOOK_HIT_OPACITY * hit * opacity,
        }),
    }
}

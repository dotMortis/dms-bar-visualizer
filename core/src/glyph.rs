//! A Lyric Word's letter, as the core hands it over for drawing: one glyph instance, everything its
//! drawing needs, so spec D can draw the words on the GPU without per-word blur layers. Laid out as
//! C's `VisualizerGlyph` (include/visualizer_core.h): change both together. Every field is a
//! double, so the WASM API can hand the glyphs over as one Float64Array, GLYPH_FIELDS a glyph.

/// One of a word's split copies, drawn behind it as a Shockwave crosses it: its color (r, g, b
/// 0..1), how far it's pushed in pixels (outward: on the bar along it, away from its center; on the
/// Lock Ring away from the Dial's center), and its opacity, under the glyph's own.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct GlyphCopy {
    pub color: [f64; 3],
    pub dx: f64,
    pub dy: f64,
    pub opacity: f64,
}

/// One letter of a Lyric Word shown.
#[repr(C)]
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Glyph {
    /// The letter: its Unicode code point.
    pub letter: f64,
    /// Which word it belongs to: its index in the Lyric Words shown. A word's glyphs come
    /// together, in its letters' order; every letter of a word has the same look.
    pub word: f64,
    /// Its middle, in pixels, tilted `angle` degrees clockwise: on the bar from its top left, on the
    /// Lock Ring from the Dial's center (y down).
    pub x: f64,
    pub y: f64,
    pub angle: f64,
    /// The word's size (1 = a settled lead vocal's), scaled around its middle (pivot).
    pub scale: f64,
    pub pivot_x: f64,
    pub pivot_y: f64,
    /// Its glow's color (r, g, b 0..1): the Ribbon's there, or on the Lock Ring its Ribbon's or
    /// Hand's, toward a Shockwave's glow as one crosses it; and its bright core's, the word's color
    /// most of the way to white.
    pub color: [f64; 3],
    pub core: [f64; 3],
    /// Its opacity, 0..1 (glyphs of words at 0 are left out).
    pub opacity: f64,
    /// Its glow's strength (above 1 for a strong one: take at most 1 as its opacity) and how far
    /// the glow spreads beyond the letter (a scale, 1 = the letter's own size).
    pub glow: f64,
    pub glow_spread: f64,
    /// How far it has blurred out as its line dissolves, 0..1 (of the glow's radius).
    pub blur: f64,
    /// How far toward white it flashes, 0..1: its pop-in or a Shockwave's flare (in `core` already).
    pub white: f64,
    /// The letters' size in pixels.
    pub em: f64,
    /// The glow's blur radius and the copies' blur, in pixels (the glyph blurs out by `blur` of
    /// the glow's radius as its line dissolves).
    pub glow_radius: f64,
    pub copy_blur: f64,
    /// Its split, in the Shockwave's colors.
    pub copies: [GlyphCopy; 3],
}

/// How many doubles a Glyph is.
pub const GLYPH_FIELDS: usize = std::mem::size_of::<Glyph>() / std::mem::size_of::<f64>();
const _: () = assert!(GLYPH_FIELDS == 40 && std::mem::size_of::<Glyph>() == 40 * 8);

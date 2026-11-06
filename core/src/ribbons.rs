//! The Bar Visualizer's Ribbons, apart from drawing: the numbers their shape and color are made
//! of, ported from docs/bar-ribbons.mjs (v0.10.0). shaders/viz.frag and the demo's port of it in
//! docs/index.html draw them and repeat these as `const float`/`const vec3` of the same names
//! (tests/bar_constants.rs checks they match), so change all three together.

// The Ribbons' wave, in bar-heights along the bar (x) and shares of its thickness across it (y):
// Ribbon k waves at RIBBON_FREQ + k * RIBBON_FREQ_STEP a bar-height, its phase the flow times
// 1 + k * RIBBON_SPEED_STEP, offset by k * RIBBON_OFFSET. The treble rides on it as a ripple
// (RIBBON_RIPPLE_FREQ times as fine, its phase RIBBON_RIPPLE_PHASE times as fast) of RIBBON_RIPPLE
// its height. At full level a crest reaches RIBBON_REACH from the bar's middle line.
pub const RIBBON_FREQ: f64 = 2.6;
pub const RIBBON_FREQ_STEP: f64 = 1.4;
pub const RIBBON_SPEED_STEP: f64 = 0.5;
pub const RIBBON_OFFSET: f64 = 2.1;
pub const RIBBON_RIPPLE: f64 = 0.3;
pub const RIBBON_RIPPLE_FREQ: f64 = 2.3;
pub const RIBBON_RIPPLE_PHASE: f64 = 1.7;
pub const RIBBON_REACH: f64 = 0.42;
// Its color is the palette at the bar's hue (HUE_*), RIBBON_HUE_STEP on per Ribbon,
// RIBBON_HUE_SPREAD more at the edges than at the center and RIBBON_HUE_LEVEL more at full level,
// deepened by RIBBON_DEEP (0..1).
pub const RIBBON_HUE_STEP: f64 = 0.33;
pub const RIBBON_HUE_SPREAD: f64 = 0.6;
pub const RIBBON_HUE_LEVEL: f64 = 0.2;
pub const RIBBON_DEEP: f64 = 0.9;

// The bar's hue: it moves HUE_SPEED a second through the palette and HUE_ALONG a bar-height across
// the bar. A color deepened by d (0..1) has each channel to the power 1 + HUE_DEEPEN * d, so the
// additive glow doesn't wash the pastels out to white.
pub const HUE_SPEED: f64 = 0.05;
pub const HUE_ALONG: f64 = 0.004;
pub const HUE_DEEPEN: f64 = 1.5;

// The palette, Catppuccin Mocha, lavender-led: it cycles lavender, mauve, lavender, pink,
// lavender, blue, easing between them.
pub const LAVENDER: [f64; 3] = [0.706, 0.745, 0.996];
pub const MAUVE: [f64; 3] = [0.796, 0.651, 0.969];
pub const PINK: [f64; 3] = [0.961, 0.761, 0.906];
pub const BLUE: [f64; 3] = [0.537, 0.706, 0.980];

// The level the Ribbons wave with: the spectrum's there times LEVEL_GAIN, LEVEL_KICK more on a
// Kick, plus LEVEL_SURGE times the Shockwaves passing, capped at 1.
pub const LEVEL_GAIN: f64 = 1.3;
pub const LEVEL_KICK: f64 = 0.7;
pub const LEVEL_SURGE: f64 = 0.6;

// A Kick's Shockwave: its front eases out from the center at SHOCK_GROW (as a share of the way to
// the edge, 1 - e^(-grow * age)) and fades at SHOCK_FADE; it lifts the Ribbons within about
// sqrt(SHOCK_WIDTH) of its front.
pub const SHOCK_GROW: f64 = 4.5;
pub const SHOCK_FADE: f64 = 2.2;
pub const SHOCK_WIDTH: f64 = 0.003;

// The whole picture shakes on a Kick (by kick²): SHAKE_X bar-heights along and SHAKE_Y of the
// thickness across, wobbling at SHAKE_FREQ_X and SHAKE_FREQ_Y radians a second.
pub const SHAKE_X: f64 = 0.35;
pub const SHAKE_Y: f64 = 0.12;
pub const SHAKE_FREQ_X: f64 = 97.0;
pub const SHAKE_FREQ_Y: f64 = 83.0;

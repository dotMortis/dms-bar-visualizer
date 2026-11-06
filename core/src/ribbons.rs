//! The Bar Visualizer's Ribbons, apart from drawing: the numbers their shape and color are made
//! of, and where each Ribbon sits at any x across the bar, its color there and how hard a
//! Shockwave crosses it, for what rides them (Lyric Words). Ported from docs/bar-ribbons.mjs
//! (v0.10.0). shaders/viz.frag and the demo's port of it in
//! docs/index.html draw them and repeat these as `const float`/`const vec3` of the same names
//! (tests/bar_constants.rs checks they match), so change all three together.

use crate::Frame;

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

/// What the shader gets that the Ribbons' shape and color depend on, for one bar: its size in
/// pixels (viz.frag's res), the bands (0..1, bass first; a missing one counts as 0), the
/// uniforms of the same names, and the Kick slots (a power of 0 is an empty slot). The intensity
/// only brightens the Ribbons, so it isn't needed.
#[derive(Clone, Copy, Debug)]
pub struct RibbonInputs<'a> {
    pub width: f64,
    pub height: f64,
    pub bands: &'a [f64],
    pub time: f64,
    pub kick: f64,
    pub treble: f64,
    pub flow: f64,
    pub bass_stretch: f64,
    pub kick_ages: &'a [f64],
    pub kick_powers: &'a [f64],
}

impl<'a> RibbonInputs<'a> {
    /// The inputs as a Frame has them, for a bar `width` x `height` pixels.
    pub fn of_frame(frame: &'a Frame, width: f64, height: f64) -> Self {
        RibbonInputs {
            width,
            height,
            bands: &frame.bands,
            time: frame.time,
            kick: frame.kick,
            treble: frame.treble,
            flow: frame.flow,
            bass_stretch: frame.bass_stretch,
            kick_ages: &frame.kick_ages,
            kick_powers: &frame.kick_powers,
        }
    }
}

/// Where an x falls in viz.frag's picture: p.x in bar-heights (shaken), dx (bar-heights from the
/// center), s (0 at the center .. 1 at the edges) and the shake across.
struct Spot {
    px: f64,
    dx: f64,
    s: f64,
    shake_y: f64,
}

fn spot_of(x: f64, i: &RibbonInputs) -> Spot {
    let k2 = i.kick * i.kick;
    let px = x / i.height + libm::sin(i.time * SHAKE_FREQ_X) * SHAKE_X * k2;
    let cx = i.width / i.height * 0.5;
    let dx = (px - cx).abs();
    Spot { px, dx, s: dx / cx, shake_y: libm::cos(i.time * SHAKE_FREQ_Y) * SHAKE_Y * k2 }
}

/// The spectrum at s (0 = bass .. 1), linearly between the bands (viz.frag's spectrum()).
fn spectrum(bands: &[f64], s: f64) -> f64 {
    let f = if s.is_nan() { 0.0 } else { s.clamp(0.0, 1.0) * 31.0 };
    let i = libm::floor(f) as usize;
    let band = |i: usize| bands.get(i).copied().filter(|b| !b.is_nan()).unwrap_or(0.0);
    let (a, b) = (band(i), band((i + 1).min(31)));
    a + (b - a) * (f - i as f64)
}

/// The level the Ribbons wave with at s, 0..1 (viz.frag's amp).
fn level_at(s: f64, i: &RibbonInputs) -> f64 {
    let mut surge = 0.0;
    for (j, &age) in i.kick_ages.iter().enumerate() {
        let power = i.kick_powers.get(j).copied().unwrap_or(0.0);
        let front = s - (1.0 - libm::exp(-age * SHOCK_GROW));
        surge += power * libm::exp(-age * SHOCK_FADE) * libm::exp(-front * front / SHOCK_WIDTH);
    }
    let level = LEVEL_GAIN * spectrum(i.bands, libm::pow(s, i.bass_stretch)) * (1.0 + LEVEL_KICK * i.kick);
    (level + LEVEL_SURGE * surge).min(1.0)
}

/// The height of Ribbon `ribbon` (0..2) at `x` pixels from the bar's left edge, as a share of the
/// bar's thickness from its top edge (the shader's qt_TexCoord0.y). The Ribbons wave outward from
/// the bar's center and mirror there, and can leave the bar on a loud crest (above 1 or below 0).
pub fn ribbon_height(x: f64, ribbon: usize, inputs: &RibbonInputs) -> f64 {
    let Spot { dx, s, shake_y, .. } = spot_of(x, inputs);
    let level = level_at(s, inputs);
    let k = ribbon as f64;
    let freq = RIBBON_FREQ + k * RIBBON_FREQ_STEP;
    let phase = inputs.flow * (1.0 + k * RIBBON_SPEED_STEP) + k * RIBBON_OFFSET;
    let ripple = libm::sin(dx * freq * RIBBON_RIPPLE_FREQ - phase * RIBBON_RIPPLE_PHASE);
    let wave = libm::sin(dx * freq - phase) + RIBBON_RIPPLE * ripple * inputs.treble;
    0.5 + RIBBON_REACH * level * wave - shake_y
}

fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// The palette at hue h (any number; it cycles once a unit), viz.frag's palette().
fn palette(h: f64) -> [f64; 3] {
    const CYCLE: [[f64; 3]; 7] = [LAVENDER, MAUVE, LAVENDER, PINK, LAVENDER, BLUE, LAVENDER];
    let f = (h - libm::floor(h)) * 6.0;
    // A NaN or infinite hue has no place in the cycle: the palette's start.
    let i = if f.is_finite() { (libm::floor(f) as usize).min(5) } else { 0 };
    let m = smoothstep(0.0, 1.0, f - i as f64);
    std::array::from_fn(|k| CYCLE[i][k] + (CYCLE[i + 1][k] - CYCLE[i][k]) * m)
}

/// The color of Ribbon `ribbon` at `x`, as r, g, b 0..1, from the same inputs as
/// [`ribbon_height`]: the color viz.frag gives its glow there, before the intensity and the
/// glow's brightness.
pub fn ribbon_color(x: f64, ribbon: usize, inputs: &RibbonInputs) -> [f64; 3] {
    let Spot { px, s, .. } = spot_of(x, inputs);
    let hue = inputs.time * HUE_SPEED
        + px * HUE_ALONG
        + ribbon as f64 * RIBBON_HUE_STEP
        + s * RIBBON_HUE_SPREAD
        + level_at(s, inputs) * RIBBON_HUE_LEVEL;
    let power = 1.0 + HUE_DEEPEN * RIBBON_DEEP;
    palette(hue).map(|c| libm::pow(c, power))
}

// How a spot feels a Shockwave crossing it (shockwave_crossing()); not in viz.frag. The hit starts
// CROSSING_LEAD ahead of the front (as a share of the way from the center to an edge), weakens at
// CROSSING_FADE a second with the time the front takes to reach the spot (gentler than SHOCK_FADE,
// so words near the edges still take a clear hit), and lingers CROSSING_HOLD s (e-folding) once
// the front has passed: the front sweeps the bar in a blink, too quick to see on its own.
pub const CROSSING_LEAD: f64 = 0.08;
pub const CROSSING_FADE: f64 = 1.1;
pub const CROSSING_HOLD: f64 = 0.22;

/// How hard a Shockwave is hitting `x` right now, 0..1, from [`ribbon_height`]'s inputs. Each
/// Shockwave hits with its power, weaker the longer its front takes to get there: nothing until
/// the front is within CROSSING_LEAD, full as it passes, then fading over CROSSING_HOLD.
/// Overlapping Shockwaves take the hardest. What makes Lyric Words flare and split.
pub fn shockwave_crossing(x: f64, inputs: &RibbonInputs) -> f64 {
    let s = spot_of(x, inputs).s;
    // When the front (1 - e^(-age * grow)) reaches s; never, at or past the edge.
    let reach = if s < 1.0 { -libm::log(1.0 - s) / SHOCK_GROW } else { f64::INFINITY };
    let mut crossing: f64 = 0.0;
    for (j, &age) in inputs.kick_ages.iter().enumerate() {
        let power = inputs.kick_powers.get(j).copied().unwrap_or(0.0);
        let hit = if age < reach {
            let ds = s - (1.0 - libm::exp(-age * SHOCK_GROW));
            libm::exp(-age * CROSSING_FADE) * (1.0 - smoothstep(0.0, CROSSING_LEAD, ds))
        } else {
            libm::exp(-reach * CROSSING_FADE) * libm::exp(-(age - reach) / CROSSING_HOLD)
        };
        crossing = crossing.max(power * hit);
    }
    crossing.min(1.0)
}

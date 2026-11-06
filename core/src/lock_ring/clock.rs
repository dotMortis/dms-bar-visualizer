// The Lock Ring's clock, apart from drawing: where the Hands point, where the Digital Time sits and
// how it takes a Shockwave's hit. Ported from v0.10.0's docs/lock-ring/clock.mjs; how the Digital
// Time reads (12h/24h, DMS's settings) stays with the host, which has the text and the fonts.
use super::ring::DIAL_RATIO;

/// Where the Digital Time sits, below the center: its font size as a share of the ring's side (as
/// DIAL_RATIO is), and in dial radii its top and the middle of its digits, half a font size lower:
/// the radius a Shockwave hits it at.
pub const TIME_FONT: f64 = 0.075;
pub const TIME_TOP: f64 = 0.38;
pub const TIME_RADIUS: f64 = TIME_TOP + TIME_FONT / DIAL_RATIO / 2.0;

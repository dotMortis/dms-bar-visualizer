// The Lock Ring's clock, apart from drawing: where the Hands point, where the Digital Time sits and
// how it takes a Shockwave's hit. Ported from v0.10.0's docs/lock-ring/clock.mjs; how the Digital
// Time reads (12h/24h, DMS's settings) stays with the host, which has the text and the fonts.
use super::ring::DIAL_RATIO;
use super::words::{RING_BLUE, RING_LAVENDER, RING_MAUVE};

/// Seconds in a day: the local time of day runs 0..DAY.
pub const DAY: f64 = 86400.0;

/// Clockwise degrees from 12 o'clock for each Hand (hour, minute, second) at the local time of day
/// `seconds` (since local midnight; any other number lands on the time of day it is). Every Hand
/// moves on with the units below it, so the second hand sweeps instead of ticking. clock.mjs
/// handAngles().
pub fn hand_angles(seconds: f64) -> [f64; 3] {
    let t = seconds.rem_euclid(DAY);
    let h = libm::floor(t / 3600.0);
    let m = libm::floor((t - h * 3600.0) / 60.0);
    let seconds = t - h * 3600.0 - m * 60.0;
    let minutes = m + seconds / 60.0;
    let hours = h % 12.0 + minutes / 60.0;
    [hours * 30.0, minutes * 6.0, seconds * 6.0]
}

/// Where the Digital Time sits, below the center: its font size as a share of the ring's side (as
/// DIAL_RATIO is), and in dial radii its top and the middle of its digits, half a font size lower:
/// the radius a Shockwave hits it at.
pub const TIME_FONT: f64 = 0.075;
pub const TIME_TOP: f64 = 0.38;
pub const TIME_RADIUS: f64 = TIME_TOP + TIME_FONT / DIAL_RATIO / 2.0;

/// The Digital Time's look at the hardest hit, tuned by eye in the demo. Sizes are in font sizes.
/// Its split copies: each one's color and how far it is pushed outward (away from the center), in
/// the Shockwave's order (lavender leads its front, mauve and blue trail it, as in ring.frag),
/// their opacity and their blur radius, so they read as light rather than print.
pub const TIME_HIT_COLORS: [[u8; 3]; 3] = [RING_LAVENDER, RING_MAUVE, RING_BLUE];
pub const TIME_HIT_SPLIT: [f64; 3] = [0.16, 0.11, 0.06];
pub const TIME_HIT_OPACITY: f64 = 0.9;
pub const TIME_HIT_SOFTEN: f64 = 0.03;
/// The digits' glow: its color, blur radius, opacity and how much wider than the digits it spreads
/// (a share of their size); and how far the digits flare toward white, 0..1.
pub const TIME_HIT_GLOW_COLOR: [u8; 3] = [0xe6, 0xeb, 0xff];
pub const TIME_HIT_GLOW_RADIUS: f64 = 0.35;
pub const TIME_HIT_GLOW_OPACITY: f64 = 1.0;
pub const TIME_HIT_GLOW_SPREAD: f64 = 0.07;
pub const TIME_HIT_WHITE: f64 = 0.6;

/// How the Digital Time takes a Shockwave crossing it: its split copies (TIME_HIT_COLORS), each
/// `copy_offsets` outward (font sizes) at `copy_opacity`; the digits' glow at `glow_opacity`,
/// `glow_scale` times their size (at TIME_HIT_GLOW_COLOR and _RADIUS); and how far the digits
/// flare toward white. The digits themselves never move.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TimeHit {
    pub copy_offsets: [f64; 3],
    pub copy_opacity: f64,
    pub glow_opacity: f64,
    pub glow_scale: f64,
    pub white: f64,
}

/// The Digital Time's look as a Shockwave crosses it (`crossing`, 0..1: shockwave_crossing() at
/// TIME_RADIUS), scaling with the crossing. clock.mjs timeHit().
pub fn time_hit(crossing: f64) -> TimeHit {
    let k = if crossing.is_finite() { crossing.clamp(0.0, 1.0) } else { 0.0 };
    TimeHit {
        copy_offsets: TIME_HIT_SPLIT.map(|offset| offset * k),
        copy_opacity: TIME_HIT_OPACITY * k,
        glow_opacity: TIME_HIT_GLOW_OPACITY * k,
        glow_scale: 1.0 + TIME_HIT_GLOW_SPREAD * k,
        white: TIME_HIT_WHITE * k,
    }
}

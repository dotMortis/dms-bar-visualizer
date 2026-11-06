// The Lock Ring's Hands, apart from drawing: where they point and how they look. Each hand is a
// neon wave ribbon showing one band: the band swings it, thickens it and lights it up, and a Kick
// flashes it and gives it a small push. The Hands float: each starts a small gap (INNER) out from
// the center. The wave only bends a hand sideways around its straight axis, which runs through the
// center at the true time: the angle comes from the time of day alone (hand_angles()). Ported from
// v0.10.0's docs/lock-ring/hands.mjs; ring.frag draws the hands and mirrors wave_envelope() and
// wave_offset().
//
// The bands differ a lot in level (in cava's output the treble sits far below the bass), so
// HandMotion measures each band against its own recent peak, and runs each hand's wave at its own
// band's pace. Lengths, widths and amplitudes are in dial radii. Hands come in HANDS' order (hour,
// minute, second), bands in theirs (bass, mid, treble): hand i shows band i.
use std::f64::consts::{PI, TAU};

use super::clock::hand_angles;

/// A Hand's plain shape in silence (length from the center and thickness, in dial radii), and its
/// share of a Kick's push (the short, thick hour hand looks busy at a full one).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Hand {
    pub length: f64,
    pub thickness: f64,
    pub push: f64,
}

/// The hour (bass), minute (mid) and second (treble) hands.
pub const HANDS: [Hand; 3] = [
    Hand { length: 0.52, thickness: 0.02, push: 0.55 },
    Hand { length: 0.78, thickness: 0.013, push: 1.0 },
    Hand { length: 0.88, thickness: 0.007, push: 1.0 },
];

/// Where every hand starts, in dial radii from the center: the gap that keeps them apart.
pub const INNER: f64 = 0.1;

/// How strongly the hands react, at a band level of 1 and at a full Kick flash: band levels are
/// taken LOOK_BOOST louder; the wave's amplitude at full level is LOOK_SWING of the hand's length;
/// the hand gets LOOK_THICKEN thicker than plain at full level; a Kick's push adds LOOK_WHIP of the
/// hand's length to the swing and makes it LOOK_REACH longer.
pub const LOOK_BOOST: f64 = 1.25;
pub const LOOK_SWING: f64 = 0.12;
pub const LOOK_THICKEN: f64 = 0.3;
pub const LOOK_WHIP: f64 = 0.06;
pub const LOOK_REACH: f64 = 0.08;

/// The wave along a hand, u from 0 at its inner end to 1 at the tip: WAVE_PERIODS periods along
/// it; the bend grows from nothing at the inner end to full by WAVE_RISE, eases back over the last
/// WAVE_FALL to WAVE_TIP of full at the tip; WAVE_RIPPLE of it is the treble's faster ripple.
pub const WAVE_PERIODS: f64 = 1.5;
pub const WAVE_RISE: f64 = 0.3;
pub const WAVE_FALL: f64 = 0.35;
pub const WAVE_TIP: f64 = 0.12;
pub const WAVE_RIPPLE: f64 = 0.15;

/// Each band's level is a share of its own recent peak, which follows a louder level at once and
/// halves every LEVEL_HALF_LIFE seconds after it; LEVEL_FLOOR is its least, on cava's 0..1.
pub const LEVEL_HALF_LIFE: f64 = 2.5;
pub const LEVEL_FLOOR: f64 = 0.04;

/// How fast a hand's wave travels out to its tip, in radians per second at speed 1: PACE_CALM at
/// all times, plus PACE_DRIVE at its band's full (normalized) level.
pub const PACE_CALM: f64 = PI;
pub const PACE_DRIVE: f64 = 6.0;

/// Each hand's phase wraps here: ring.frag uses it times 1, 1.5 and 2 (one per strand), and those
/// times 1.7 (the ripple): all whole multiples of 2π at 40π, so the wrap is seamless.
pub const PHASE_WRAP: f64 = 40.0 * PI;

fn clamp01(x: f64) -> f64 {
    if x.is_nan() {
        0.0
    } else {
        x.clamp(0.0, 1.0)
    }
}

fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = clamp01((x - a) / (b - a));
    t * t * (3.0 - 2.0 * t)
}

/// How much of the amplitude the wave may use at u: 0 at the inner end, 1 along the middle,
/// WAVE_TIP at the tip.
pub fn wave_envelope(u: f64) -> f64 {
    let fall = smoothstep(1.0 - WAVE_FALL, 1.0, u);
    smoothstep(0.0, WAVE_RISE, u) * (1.0 + (WAVE_TIP - 1.0) * fall)
}

/// A strand's sideways offset at u: a wave travelling from the inner end to the tip as `phase`
/// (radians) grows, with a faster ripple mixed in by `treble` (0..1). Never more than amplitude *
/// envelope.
pub fn wave_offset(u: f64, phase: f64, amplitude: f64, treble: f64) -> f64 {
    let tr = clamp01(treble) * WAVE_RIPPLE;
    let x = TAU * WAVE_PERIODS * u;
    let wave = (1.0 - tr) * libm::sin(x - phase) + tr * libm::sin(x * 2.3 - phase * 1.7);
    amplitude * wave_envelope(u) * wave
}

/// How a Hand looks: its wave's sideways reach in dial radii (0 = a straight line), the factor on
/// its plain thickness and on its plain length (a Kick pushes its tip outward), its neon glow and
/// how brightly it flashes, both 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct HandLook {
    pub amplitude: f64,
    pub thicken: f64,
    pub glow: f64,
    pub flash: f64,
    pub stretch: f64,
}

/// How a hand of `length` looks at band `level` (cava's 0..1) and Kick `flash` (0..1,
/// hand_flash()), with the wave scaled by `strength` (the handWaves setting) and the Kick's push by
/// `push` (its HANDS entry's). A Kick only pushes a little: the swing is the band's.
pub fn hand_look(length: f64, level: f64, flash: f64, strength: f64, push: f64) -> HandLook {
    let l = clamp01(LOOK_BOOST * clamp01(level));
    let f = clamp01(flash);
    let s = if strength.is_finite() { strength.max(0.0) } else { 1.0 };
    HandLook {
        amplitude: length * s * (LOOK_SWING * l + LOOK_WHIP * push * f),
        thicken: 1.0 + LOOK_THICKEN * l,
        glow: l,
        flash: f,
        stretch: 1.0 + LOOK_REACH * push * f,
    }
}

/// A Hand's pose: its angle (clockwise degrees from 12 o'clock, from the time alone), where it
/// starts (inner) and ends (length, pushed out by a Kick) and its width, in dial radii, and its
/// look (hand_look()).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HandPose {
    pub angle: f64,
    pub inner: f64,
    pub length: f64,
    pub width: f64,
    pub amplitude: f64,
    pub thicken: f64,
    pub glow: f64,
    pub flash: f64,
    pub stretch: f64,
}

/// Each Hand's pose at the local time of day `seconds` (since local midnight), given the bands'
/// `levels` (bass, mid, treble on 0..1), the Kick `flash` and the wave `strength`. hands.mjs
/// handPoses().
pub fn hand_poses(seconds: f64, levels: [f64; 3], flash: f64, strength: f64) -> [HandPose; 3] {
    let angles = hand_angles(seconds);
    std::array::from_fn(|i| {
        let Hand { length, thickness, push } = HANDS[i];
        let look = hand_look(length, levels[i], flash, strength, push);
        HandPose {
            angle: angles[i],
            inner: INNER,
            length: length * look.stretch,
            width: thickness * look.thicken,
            amplitude: look.amplitude,
            thicken: look.thicken,
            glow: look.glow,
            flash: look.flash,
            stretch: look.stretch,
        }
    })
}

/// The Hands' motion, stepped once per display frame with bass/mid/treble on cava's 0..1 scale
/// (hands.mjs createHandMotion()): `levels`, each band as a share of its own recent peak, 0..1, and
/// `phases`, how far each hand's wave has travelled, in radians.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct HandMotion {
    peaks: [f64; 3],
    pub levels: [f64; 3],
    pub phases: [f64; 3],
}

impl HandMotion {
    pub fn step(&mut self, bands: [f64; 3], dt: f64, speed: f64) {
        let dt = dt.max(0.0);
        let keep = libm::pow(0.5, dt / LEVEL_HALF_LIFE);
        for ((peak, out), band) in self.peaks.iter_mut().zip(&mut self.levels).zip(bands) {
            let level = clamp01(band);
            *peak = level.max(*peak * keep);
            *out = clamp01(level / peak.max(LEVEL_FLOOR));
        }
        for i in 0..3 {
            let pace = PACE_CALM + PACE_DRIVE * self.levels[i];
            // Kept finite whatever dt and speed, so the phase wraps instead of turning NaN.
            self.phases[i] = (self.phases[i] + (dt * speed * pace).min(f64::MAX)).min(f64::MAX) % PHASE_WRAP;
        }
    }
}

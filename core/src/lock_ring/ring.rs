// The Lock Ring's look, apart from drawing: where the spectrum sits on the ring, the ribbon that is
// the Dial (a calm, living wave in silence that the music grows into spectrum ribbons waving
// outward from the swelling Dial), the 12 Hour Points riding on it, and how the ring swells with
// the music. Ported from v0.10.0's docs/lock-ring/ring.mjs; ring.frag mirrors spectrum_at(),
// spectrum_level(), ribbon_level(), ribbon_radius() and hour_points().
use std::f64::consts::{PI, TAU};

/// The Dial's radius as a share of the widget's side, leaving room around it for the ribbons to
/// wave into. ring.frag's DIAL_RATIO.
pub const DIAL_RATIO: f64 = 0.34;

/// Position on the spectrum, 0 (lowest band) to 1 (highest), at `angle` clockwise degrees from
/// 12 o'clock. Bass at the bottom, highs meeting at the top, the left half mirroring the right.
/// bass_stretch > 1 spreads the bass over more of the ring, as the bar's bassStretch does.
pub fn spectrum_at(angle: f64, bass_stretch: f64) -> f64 {
    let a = ((angle % 360.0) + 360.0) % 360.0;
    let from_bottom = (a - 180.0).abs() / 180.0;
    libm::pow(from_bottom, bass_stretch)
}

/// The spectrum's level at s (0 = lowest band .. 1 = highest) across the bands in `values` (bass
/// first), smoothed with a monotone cubic (Fritsch-Butland) between them: it passes through every
/// band's value, with no corner where one band meets the next, and never overshoots its two bands.
/// Flat at both ends. ring.frag's spectrum().
pub fn spectrum_level(values: &[f64], s: f64) -> f64 {
    if values.len() < 2 {
        return values.first().copied().filter(|v| !v.is_nan()).unwrap_or(0.0);
    }
    let n = values.len() - 1;
    let f = s.clamp(0.0, 1.0) * n as f64;
    let i = (libm::floor(f) as usize).min(n - 1);
    let t = f - i as f64;
    let at = |j: isize| {
        let v = values[j.clamp(0, n as isize) as usize];
        if v.is_nan() {
            0.0
        } else {
            v
        }
    };
    let slope = |j: isize| {
        if j <= 0 || j >= n as isize {
            return 0.0;
        }
        let (d0, d1) = (at(j) - at(j - 1), at(j + 1) - at(j));
        if d0 * d1 > 0.0 {
            2.0 * d0 * d1 / (d0 + d1)
        } else {
            0.0
        }
    };
    let i = i as isize;
    let (a, b, t2) = (at(i), at(i + 1), t * t);
    let t3 = t2 * t;
    a * (2.0 * t3 - 3.0 * t2 + 1.0) + slope(i) * (t3 - 2.0 * t2 + t) + b * (3.0 * t2 - 2.0 * t3) + slope(i + 1) * (t3 - t2)
}

/// The level the ribbons wave with at s (0 = lowest band .. 1 = highest): spectrum_level()
/// averaged over its neighbours RIBBON_SMOOTH and twice that apart (weights 1 2 3 2 1), mirrored at
/// both ends of the spectrum. ring.frag's ribbonSpectrum().
pub fn ribbon_level(values: &[f64], s: f64) -> f64 {
    let at = |x: f64| {
        spectrum_level(
            values,
            if x < 0.0 {
                -x
            } else if x > 1.0 {
                2.0 - x
            } else {
                x
            },
        )
    };
    let d = RIBBON_SMOOTH;
    (at(s - 2.0 * d) + 2.0 * at(s - d) + 3.0 * at(s) + 2.0 * at(s + d) + at(s + 2.0 * d)) / 9.0
}

/// The ribbon in silence: never a fixed circle, but a thin, slow wave around the dial radius.
/// How far it strays from the dial radius, in dial radii; how fast its wave drifts around the dial,
/// in turns of phase per second (strand 0); how fast it breathes, times a second; and how bright it
/// is in silence, as a share of its brightness with music.
pub const IDLE_REACH: f64 = 0.035;
pub const IDLE_DRIFT: f64 = 0.05;
pub const IDLE_BREATH: f64 = 0.1;
pub const IDLE_GLOW: f64 = 0.4;

/// The ribbon with music: how far a strand's crest rises above the Dial at full level, in dial
/// radii; how much of the treble rides on the wave as a faster ripple; how far from 6 and 12
/// o'clock the wave is rounded where the mirrored halves meet, in radians; and how far apart along
/// the spectrum ribbon_level() averages the levels.
pub const RIBBON_REACH: f64 = 0.2;
pub const RIBBON_RIPPLE: f64 = 0.2;
pub const RIBBON_ROUND: f64 = 0.25;
pub const RIBBON_SMOOTH: f64 = 0.06;

/// The Aura's own reach: how far it spreads from the calm spine either way at full level, in dial
/// radii, and how much the treble widens it.
pub const AURA_REACH: f64 = 0.25;
pub const AURA_RIPPLE: f64 = 0.3;

/// How far the wave has come from 6 o'clock at `a` radians from it (0..PI, the same on both sides):
/// `a` itself, but rounded within RIBBON_ROUND of either end so it meets its mirror image level.
fn unfold(a: f64) -> f64 {
    let r = RIBBON_ROUND;
    let bend = |v: f64| if v < r { (r - v) * (r - v) / (2.0 * r) } else { 0.0 };
    a + bend(a) - bend(PI - a)
}

/// What ribbon_radius() reads: the spectrum's level there (0..1), the wave phase (flow), the
/// animation clock (time), the treble, the swell, and which strand (0..2).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct RibbonAt {
    pub level: f64,
    pub flow: f64,
    pub time: f64,
    pub treble: f64,
    pub swell: f64,
    pub strand: usize,
}

/// The radius of a strand at `angle` clockwise degrees from 12 o'clock, in dial radii: the Dial
/// (1), swollen by the swell, waved around by the music (its level, its waves advanced by flow and
/// rippled by the treble), plus the idle wave, which breathes and drifts with time. Every rate is
/// a multiple of 1/1200 Hz, so the shader's time wrap at 1200 s is seamless. ring.frag's
/// ribbonRadius() mirrors it.
pub fn ribbon_radius(angle: f64, at: &RibbonAt) -> f64 {
    let RibbonAt { level, flow, time, treble, swell, strand } = *at;
    let k = strand as f64;
    let sin = libm::sin;
    let theta = (((angle % 360.0) + 360.0) % 360.0) * PI / 180.0;
    let a = unfold((theta - PI).abs()); // from the bottom, the same on both sides
    let freq = 3.0 + k;
    let phase = flow * (1.0 + 0.5 * k) + 2.1 * k;
    // 0 on the dial .. 1 at the crest; the ripple rides on it, so it never dips inside.
    let swing = 0.5 + 0.5 * sin(a * freq - phase);
    let wave = swing * (1.0 + RIBBON_RIPPLE * treble * sin(a * freq * 2.3 - phase * 1.7));
    let music = RIBBON_REACH * level * wave;
    let breath = 0.7 + 0.3 * sin(TAU * IDLE_BREATH * time + 1.7 * k);
    let idle = IDLE_REACH * breath * sin(theta * (3.0 + k) + TAU * IDLE_DRIFT * (1.0 + 0.5 * k) * time + 2.1 * k);
    1.0 + swell + music + idle
}

/// What the ribbon and the Hour Points are drawn from: the bands (bass first), the wave phase, the
/// animation clock, the treble, the ring motion (swell, presence) and the bassStretch setting.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RingScene<'a> {
    pub values: &'a [f64],
    pub flow: f64,
    pub time: f64,
    pub treble: f64,
    pub swell: f64,
    pub presence: f64,
    pub bass_stretch: f64,
}

/// How many Hour Points ride the ribbon: one every 30 degrees, from 12 o'clock.
pub const HOUR_POINTS: usize = 12;

/// An Hour Point: its angle (clockwise degrees from 12 o'clock), radius (dial radii) and glow.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HourPoint {
    pub angle: f64,
    pub radius: f64,
    pub glow: f64,
}

/// The 12 Hour Points riding on the ribbon. `crossing(radius, theta)` is how brightly a Shockwave's
/// front is crossing a radius in a direction (radians clockwise from 12 o'clock) right now
/// (shockwave_crossing()), `surge(radius, theta)` how much the Shockwaves lift the ribbons there
/// (ribbon_surge()). Each rides strand 0, surged where the strand sits before the surge, as the
/// ribbon is; its glow is brighter at 12, 3, 6 and 9, dimmer in silence, and flashes as a
/// Shockwave's front reaches its radius. ring.frag mirrors this.
pub fn hour_points(
    scene: &RingScene,
    crossing: impl Fn(f64, f64) -> f64,
    surge: impl Fn(f64, f64) -> f64,
) -> [HourPoint; HOUR_POINTS] {
    let RingScene { values, flow, time, treble, swell, presence, bass_stretch } = *scene;
    let mut points = [HourPoint::default(); HOUR_POINTS];
    for (i, point) in points.iter_mut().enumerate() {
        let angle = i as f64 * 30.0;
        let theta = angle * TAU / 360.0;
        let music = 1.3 * ribbon_level(values, spectrum_at(angle, bass_stretch));
        let on = |level| ribbon_radius(angle, &RibbonAt { level, flow, time, treble, swell, strand: 0 });
        let calm = on(music.min(1.0));
        let radius = on((music + surge(calm, theta)).min(1.0));
        let quarter = if i % 3 == 0 { 1.0 } else { 0.6 };
        *point = HourPoint { angle, radius, glow: quarter * (0.6 + 0.4 * presence) + 0.8 * crossing(radius, theta) };
    }
    points
}

/// How far the ring swells at full scale, as a fraction of the dial radius.
pub const MAX_SWELL: f64 = 0.08;

/// Eases `value` toward `target` with time constant `tau` seconds.
fn follow(value: f64, target: f64, dt: f64, tau: f64) -> f64 {
    value + (target - value) * (1.0 - libm::exp(-dt / tau))
}

/// The ring's motion, stepped once per display frame with bass/mid/treble (ring.mjs
/// createRingMotion()): the swell (the ring's radius grows by this fraction of the dial radius,
/// following the beat) and the presence (0..1, how much music the ribbon shows: 0 = only its calm
/// idle wave).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct RingMotion {
    pub swell: f64,
    pub presence: f64,
}

impl RingMotion {
    pub fn step(&mut self, bass: f64, mid: f64, treble: f64, dt: f64) {
        let energy = 0.5 * bass + 0.3 * mid + 0.2 * treble;
        let swell = MAX_SWELL * energy;
        // Quick up on a hit and quick down after it, so the ring pulses instead of drifting.
        self.swell = follow(self.swell, swell, dt, if swell > self.swell { 0.03 } else { 0.1 });
        // Quiet music still shows the ribbons in full; they fade out slower than they come in.
        let presence = (energy * 5.0).min(1.0);
        self.presence = follow(self.presence, presence, dt, if presence > self.presence { 0.06 } else { 0.3 });
    }
}

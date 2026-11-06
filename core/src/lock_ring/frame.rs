// The Lock Ring's own state, as a Visualizer of the Lock Ring kind keeps it: what ring.frag needs
// on top of the Frame, and what the host draws over it (the Digital Time's hit). Stepped as
// LockAudio.qml and LockRing.qml did in v0.10.0.
use std::f64::consts::PI;

use super::*;
use crate::{Frame, KICK_SLOTS};

/// How close to nothing the ring's swell and presence have to be for the ring to have settled
/// (lock-ring/pace.mjs AT_REST): until then the Lock Ring is still animating.
pub const AT_REST: f64 = 0.01;

/// The Lock Ring's state, as of the last call. Laid out as C's `VisualizerLockRing`
/// (include/visualizer_core.h): change both together. The hands are in HANDS' order (hour, minute,
/// second), as ring.frag's handAngle..handPhase x, y, z; sizes are in dial radii.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LockRingFrame {
    /// The ring's motion: how far it swells (a fraction of the dial radius, following the beat),
    /// and how much music its ribbon shows (0 = only its calm idle wave .. 1). Stepped at display
    /// time, not at the speed setting.
    pub swell: f64,
    pub presence: f64,
    /// How brightly every hand flashes, 0..1: lit by each Kick at its power, fading at kickDecay.
    pub hand_flash: f64,
    /// Where each hand points, in radians clockwise from 12 o'clock: from the local time alone
    /// (set_local_time), whatever the music does.
    pub hand_angles: [f64; 3],
    /// Where each hand starts and ends, from the center; its wave's sideways reach (0 = straight),
    /// its width and its glow (0..1).
    pub hand_inner: [f64; 3],
    pub hand_lengths: [f64; 3],
    pub hand_amplitudes: [f64; 3],
    pub hand_widths: [f64; 3],
    pub hand_glows: [f64; 3],
    /// How far each hand's wave has travelled, in radians, wrapped at PHASE_WRAP.
    pub hand_phases: [f64; 3],
    /// Each hand's band (bass, mid, treble) as a share of its own recent peak, 0..1.
    pub hand_levels: [f64; 3],
    /// The Kick slots as ring.frag takes them: the Frame's, with a played-out or empty slot at age
    /// 100, power 0 and seed 0.
    pub kick_ages: [f64; KICK_SLOTS],
    pub kick_powers: [f64; KICK_SLOTS],
    pub kick_seeds: [f64; KICK_SLOTS],
    /// The Hour Points riding the ribbon, one every 30 degrees from 12 o'clock: each one's radius
    /// and glow (flashing as a Shockwave's front reaches it), as ring.frag draws them.
    pub hour_radii: [f64; HOUR_POINTS],
    pub hour_glows: [f64; HOUR_POINTS],
    /// How brightly a Shockwave's front is crossing the Digital Time (at TIME_RADIUS, 6 o'clock),
    /// 0..1, and the look that gives it.
    pub time_crossing: f64,
    pub time_hit: TimeHit,
}

impl Default for LockRingFrame {
    fn default() -> Self {
        LockRingFrame {
            swell: 0.0,
            presence: 0.0,
            hand_flash: 0.0,
            hand_angles: [0.0; 3],
            hand_inner: [INNER; 3],
            hand_lengths: HANDS.map(|h| h.length),
            hand_amplitudes: [0.0; 3],
            hand_widths: HANDS.map(|h| h.thickness),
            hand_glows: [0.0; 3],
            hand_phases: [0.0; 3],
            hand_levels: [0.0; 3],
            kick_ages: [100.0; KICK_SLOTS],
            kick_powers: [0.0; KICK_SLOTS],
            kick_seeds: [0.0; KICK_SLOTS],
            hour_radii: [1.0; HOUR_POINTS],
            hour_glows: [0.0; HOUR_POINTS],
            time_crossing: 0.0,
            time_hit: time_hit(0.0),
        }
    }
}

/// The Lock Ring's running state: its motions and the local time.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct LockRing {
    ring: RingMotion,
    hands: HandMotion,
    /// Seconds since local midnight.
    local_time: f64,
    pub frame: LockRingFrame,
    /// The Hands' poses, as of the last update: what the Lyric Words on them lie along.
    pub poses: [HandPose; 3],
}

impl LockRing {
    pub fn set_local_time(&mut self, seconds: f64) {
        if seconds.is_finite() {
            self.local_time = seconds.rem_euclid(DAY);
        }
    }

    /// One display frame, `dt` seconds (0 or more) after the last, at `speed`.
    pub fn step(&mut self, f: &Frame, dt: f64, speed: f64) {
        self.ring.step(f.bass, f.mid, f.treble, dt);
        self.hands.step([f.bass, f.mid, f.treble], dt, speed);
    }

    /// Everything else, from the Frame, the motions, the local time and the settings.
    pub fn update(&mut self, f: &Frame, kick_decay: f64, hand_waves: f64) {
        let (ages, powers, seeds) = (&f.kick_ages, &f.kick_powers, &f.kick_seeds);
        let out = &mut self.frame;
        (out.swell, out.presence) = (self.ring.swell, self.ring.presence);
        out.hand_levels = self.hands.levels;
        out.hand_phases = self.hands.phases;
        out.hand_flash = hand_flash(ages, powers, kick_decay);
        let poses = hand_poses(self.local_time, self.hands.levels, out.hand_flash, hand_waves);
        self.poses = poses;
        for (i, pose) in poses.iter().enumerate() {
            out.hand_angles[i] = pose.angle * PI / 180.0;
            out.hand_inner[i] = pose.inner;
            out.hand_lengths[i] = pose.length;
            out.hand_amplitudes[i] = pose.amplitude;
            out.hand_widths[i] = pose.width;
            out.hand_glows[i] = pose.glow;
        }
        let slots = kick_slots(ages, powers, seeds);
        (out.kick_ages, out.kick_powers, out.kick_seeds) = (slots.ages, slots.powers, slots.seeds);
        let scene = RingScene {
            values: &f.bands,
            flow: f.flow,
            time: f.time,
            treble: f.treble,
            swell: out.swell,
            presence: out.presence,
            bass_stretch: f.bass_stretch,
        };
        let points = hour_points(
            &scene,
            |r, theta| shockwave_crossing(r, ages, powers, seeds, Some(theta)),
            |r, theta| ribbon_surge(r, ages, powers, seeds, Some(theta)),
        );
        for (i, point) in points.iter().enumerate() {
            out.hour_radii[i] = point.radius;
            out.hour_glows[i] = point.glow;
        }
        out.time_crossing = shockwave_crossing(TIME_RADIUS, ages, powers, seeds, Some(PI));
        out.time_hit = time_hit(out.time_crossing);
    }

    /// Whether the ring itself still moves without sound: its swell or presence not yet settled.
    pub fn settling(&self) -> bool {
        self.ring.swell >= AT_REST || self.ring.presence >= AT_REST
    }
}

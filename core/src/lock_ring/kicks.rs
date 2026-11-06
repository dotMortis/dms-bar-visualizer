// Kicks on the Lock Ring, apart from drawing: how each one's Shockwave grows out of the center, how
// brightly it crosses a radius as it passes, how it lifts the ribbons, how the center punches as it
// is born, how it pushes the Aura outward, and how the Hands flash. Ported from v0.10.0's
// docs/lock-ring/kicks.mjs. lock-ring/shaders/ring.frag mirrors kick_at(), shockwave_front(),
// shockwave_crossing(), ribbon_surge(), center_punch() and aura_push() and has the same constants
// (tests/lock_constants.rs). The sparks a Kick flings off the ring are the shader's alone.
//
// Distances are in dial radii (1 = the dial), ages in seconds, power is the Kick's (0.5..1). The
// Kicks come as the frame's Kick slots: `ages`, `powers` and `seeds`, any order; a slot missing
// from a shorter slice is empty.
use std::f64::consts::TAU;

use super::ring::DIAL_RATIO;
use crate::{KICK_SLOTS, PLAYED_OUT};

/// Where a Shockwave starts (a small round at the center; the Hands float around it) and the
/// widget's edge, in dial radii.
pub const KICK_ORIGIN: f64 = 0.014 / DIAL_RATIO;
pub const EDGE: f64 = 0.5 / DIAL_RATIO;
/// The hardest hit's Shockwave stops here, where the ring's edge fade starts.
pub const MAX_REACH: f64 = 0.9 * EDGE;
/// How fast a Shockwave eases out to its reach, and how fast it fades, per second.
pub const KICK_GROW: f64 = 4.5;
pub const KICK_FADE: f64 = 2.2;

/// How far a Shockwave's front strays from round in its soft lobes, as a share of how far it has
/// travelled, and how much brighter one side of it is than the other (shockwave_front()).
pub const SHAPE_REACH: f64 = 0.12;
pub const SHAPE_LIGHT: f64 = 0.3;
/// Its ragged edge on top of the lobes: how far it strays (as SHAPE_REACH), and how much darker the
/// edge flickers at its dimmest.
pub const ROUGH_REACH: f64 = 0.09;
pub const ROUGH_LIGHT: f64 = 0.45;
/// How wild a Kick's shape is from its power: a soft one's (at SHAPE_SOFT or below) is SHAPE_CALM of
/// a hard one's (at SHAPE_HARD or above), so busy tracks stay calm and drops tear the front.
pub const SHAPE_CALM: f64 = 0.25;
pub const SHAPE_SOFT: f64 = 0.55;
pub const SHAPE_HARD: f64 = 0.95;

/// How far ahead of a Shockwave's front, and how far behind it, a radius still feels it crossing,
/// in dial radii (shockwave_crossing()).
pub const CROSSING_LEAD: f64 = 0.1;
pub const CROSSING_TRAIL: f64 = 0.3;

/// How the ribbons surge where a Shockwave's front crosses them (ribbon_surge()): the front's reach
/// either side, a Gaussian's 2σ² in dial radii squared, and the lift at full strength, in spectrum
/// level.
pub const SURGE_WIDTH: f64 = 0.006;
pub const SURGE_LIFT: f64 = 0.6;

/// How fast the Center Punch fades, per second (center_punch()).
pub const PUNCH_FADE: f64 = 15.0;

/// How a Kick pushes the Aura outward (aura_push()): how far at full power, in dial radii, how fast
/// the push eases out and how fast it eases back, per second.
pub const AURA_PUSH: f64 = 0.15;
pub const AURA_RISE: f64 = 25.0;
pub const AURA_FALL: f64 = 4.0;

/// A Shockwave as it is right now: its front's radius and how bright it is, 0..1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Shockwave {
    pub front: f64,
    pub strength: f64,
}

/// A Kick `age` seconds after it fired, at `power`: its round Shockwave, easing out from the center
/// (fast burst, slowing at the edge) to a reach that grows with power, and fading.
pub fn kick_at(age: f64, power: f64) -> Shockwave {
    let reach = KICK_ORIGIN + (MAX_REACH - KICK_ORIGIN) * power;
    Shockwave {
        front: KICK_ORIGIN + (reach - KICK_ORIGIN) * (1.0 - libm::exp(-age * KICK_GROW)),
        strength: power * libm::exp(-age * KICK_FADE),
    }
}

/// The ring shader's Kick slots: a slot is live while its Kick is (finite age and power, power
/// above 0, younger than PLAYED_OUT); any other is empty: age 100, power 0, seed 0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct KickSlots {
    pub ages: [f64; KICK_SLOTS],
    pub powers: [f64; KICK_SLOTS],
    pub seeds: [f64; KICK_SLOTS],
}

/// The Kicks as the shader's KICK_SLOTS slots (kicks.mjs kickSlots()).
pub fn kick_slots(ages: &[f64], powers: &[f64], seeds: &[f64]) -> KickSlots {
    let mut slots = KickSlots { ages: [100.0; KICK_SLOTS], powers: [0.0; KICK_SLOTS], seeds: [0.0; KICK_SLOTS] };
    for i in 0..KICK_SLOTS {
        let (age, power) = (ages.get(i).copied().unwrap_or(f64::NAN), powers.get(i).copied().unwrap_or(f64::NAN));
        if age.is_finite() && power.is_finite() && power > 0.0 && age < PLAYED_OUT {
            slots.ages[i] = age;
            slots.powers[i] = power;
            slots.seeds[i] = seeds.get(i).copied().filter(|s| s.is_finite()).unwrap_or(0.0);
        }
    }
    slots
}

fn fract(x: f64) -> f64 {
    x - libm::floor(x)
}

pub(crate) fn smoothstep(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// How wild a Kick of `power` (0.5..1) shapes its Shockwave, SHAPE_CALM..1.
pub fn shape_chaos(power: f64) -> f64 {
    SHAPE_CALM + (1.0 - SHAPE_CALM) * smoothstep(SHAPE_SOFT, SHAPE_HARD, power)
}

/// A Kick's Shockwave `age` seconds after it fired, in the direction `angle` (radians clockwise
/// from 12 o'clock): kick_at()'s front and strength, given the Kick's own shape. Each Kick (its
/// `seed`) wobbles in its own few soft lobes and is brighter on one side, and its edge is ragged
/// like a flame front, the rags running along it and flickering as it travels; it is born round
/// and wobbles more as it travels, and a harder Kick's shape is wilder (shape_chaos()). Without an
/// angle it is the round kick_at(). ring.frag's kickFront() mirrors it.
pub fn shockwave_front(age: f64, power: f64, seed: f64, angle: Option<f64>) -> Shockwave {
    let Shockwave { front, strength } = kick_at(age, power);
    let Some(angle) = angle else { return Shockwave { front, strength } };
    let s = seed;
    let chaos = shape_chaos(power);
    let sin = libm::sin;
    let wobble = 0.5 * sin(2.0 * angle + TAU * fract(s * 0.618034))
        + 0.35 * sin(3.0 * angle + TAU * fract(s * 0.754878))
        + 0.15 * sin(5.0 * angle + TAU * fract(s * 0.569840));
    let spin = TAU * fract(s * 0.302776);
    let rough = 0.5 * sin(5.0 * angle + spin)
        + 0.3 * sin(9.0 * angle - 1.7 * spin + 3.0 * age)
        + 0.2 * sin(17.0 * angle + 2.3 * spin - 6.0 * age);
    let flicker = 1.0 - ROUGH_LIGHT * chaos * (0.5 - 0.5 * sin(11.0 * angle - spin + 4.0 * age));
    let reach = chaos * (SHAPE_REACH * (0.5 + 0.5 * fract(s * 0.414214)) * wobble + ROUGH_REACH * rough);
    Shockwave {
        front: KICK_ORIGIN + (front - KICK_ORIGIN) * (1.0 + reach),
        strength: strength * (1.0 + SHAPE_LIGHT * sin(angle + TAU * fract(s * 0.819173))) * flicker,
    }
}

/// The live Shockwaves among the Kicks: each one's age and power, and its front and strength in
/// the direction `angle` (shockwave_front()).
fn shockwaves(
    ages: &[f64],
    powers: &[f64],
    seeds: &[f64],
    angle: Option<f64>,
) -> impl Iterator<Item = (f64, f64, Shockwave)> {
    let slots = kick_slots(ages, powers, seeds);
    (0..KICK_SLOTS).filter(move |&i| slots.powers[i] > 0.0).map(move |i| {
        let (age, power) = (slots.ages[i].max(0.0), slots.powers[i]);
        (age, power, shockwave_front(age, power, slots.seeds[i], angle))
    })
}

/// How brightly a Shockwave's front is crossing `radius` (dial radii) right now, 0..1. Each
/// Shockwave counts with its strength, shaped by how close its front is: nothing until the front is
/// within CROSSING_LEAD, full strength as it passes, gone once it is CROSSING_TRAIL beyond.
/// Overlapping Shockwaves take the brightest. What the Hour Points and the Digital Time flash by.
/// With a direction (`angle`) it follows each Kick's shaped front there (its seed); without, the
/// round one. ring.frag's shockwaveCrossing() mirrors it.
pub fn shockwave_crossing(radius: f64, ages: &[f64], powers: &[f64], seeds: &[f64], angle: Option<f64>) -> f64 {
    let mut crossing: f64 = 0.0;
    for (_, _, Shockwave { front, strength }) in shockwaves(ages, powers, seeds, angle) {
        let ds = radius - front; // > 0 ahead of the front, < 0 behind it
        let near = if ds >= 0.0 {
            1.0 - smoothstep(0.0, CROSSING_LEAD, ds)
        } else {
            1.0 - smoothstep(0.0, CROSSING_TRAIL, -ds)
        };
        crossing = crossing.max(strength * near);
    }
    crossing.min(1.0)
}

/// How much the Shockwaves lift the ribbons at `radius` (dial radii) right now, in spectrum level
/// to add to the music's (0 = none): each Shockwave lifts by its strength where its front is,
/// falling off within about 0.1 either side (SURGE_WIDTH). Overlapping surges add up.
/// `seeds` and `angle` as shockwave_crossing(). ring.frag's ribbonSurge() mirrors it.
pub fn ribbon_surge(radius: f64, ages: &[f64], powers: &[f64], seeds: &[f64], angle: Option<f64>) -> f64 {
    let mut surge = 0.0;
    for (_, _, Shockwave { front, strength }) in shockwaves(ages, powers, seeds, angle) {
        let ds = radius - front;
        surge += strength * libm::exp(-ds * ds / SURGE_WIDTH);
    }
    SURGE_LIFT * surge
}

/// How brightly the center punches right now, 0..1: every Kick punches as its Shockwave is born,
/// at its own power, and fades at PUNCH_FADE; overlapping punches take the brightest. ring.frag's
/// centerPunch() mirrors it.
pub fn center_punch(ages: &[f64], powers: &[f64]) -> f64 {
    shockwaves(ages, powers, &[], None)
        .map(|(age, power, _)| power * libm::exp(-age * PUNCH_FADE))
        .fold(0.0, f64::max)
        .min(1.0)
}

/// How far the Kicks push the Aura outward right now, 0..1 of AURA_PUSH: every Kick eases it out
/// at AURA_RISE and back at AURA_FALL, as far as its power; overlapping pushes take the farthest.
/// ring.frag's auraPush() mirrors it.
pub fn aura_push(ages: &[f64], powers: &[f64]) -> f64 {
    shockwaves(ages, powers, &[], None)
        .map(|(age, power, _)| power * (1.0 - libm::exp(-age * AURA_RISE)) * libm::exp(-age * AURA_FALL))
        .fold(0.0, f64::max)
        .min(1.0)
}

/// How brightly the Hands flash, 0..1, from the same Kicks as the Shockwaves: every Kick lights them
/// at its power and fades at `decay` per second (the kickDecay setting). Overlapping Kicks take the
/// brightest, so a new hit flashes again.
pub fn hand_flash(ages: &[f64], powers: &[f64], decay: f64) -> f64 {
    let slots = kick_slots(ages, powers, &[]);
    let mut flash: f64 = 0.0;
    for i in 0..KICK_SLOTS {
        flash = flash.max(slots.powers[i] * libm::exp(-slots.ages[i].max(0.0) * decay));
    }
    flash.min(1.0)
}

// Kicks on the Lock Ring, apart from drawing: how each one's Shockwave grows out of the center,
// how brightly it crosses a radius as it passes, how it lifts the ribbons, how the center punches
// as it is born, how it pushes the Aura outward, and how the hands flash. Plain JS for tests/lock-kicks.test.mjs;
// shaders/ring.frag mirrors kickAt(), shockwaveFront(), shockwaveCrossing(), ribbonSurge() and
// centerPunch() and auraPush() and has the same constants (tests/lock-constants.test.mjs). The sparks a Kick
// flings off the ring are the shader's alone.
// Distances are in dial radii (1 = the dial), ages in seconds, power is the shared detector's
// hit strength (0.5..1, docs/kick.mjs).
import { DIAL_RATIO } from "./ring.mjs";

// Where a Shockwave starts (a small round at the center; the hands float around it) and the
// widget's edge, in dial radii.
export const KICK_ORIGIN = 0.014 / DIAL_RATIO;
export const EDGE = 0.5 / DIAL_RATIO;
// The hardest hit's Shockwave stops here, where the ring's edge fade starts.
export const MAX_REACH = 0.9 * EDGE;
// How fast a Shockwave eases out to its reach, and how fast it fades, per second.
export const KICK_GROW = 4.5;
export const KICK_FADE = 2.2;

// A kick `age` seconds after it fired:
//   front     the Shockwave's radius: eases out from the center (fast burst, slowing at the
//             edge) to a reach that grows with power
//   strength  how bright the Shockwave is, 0..1
export function kickAt(age, power) {
    const reach = KICK_ORIGIN + (MAX_REACH - KICK_ORIGIN) * power;
    return {
        front: KICK_ORIGIN + (reach - KICK_ORIGIN) * (1 - Math.exp(-age * KICK_GROW)),
        strength: power * Math.exp(-age * KICK_FADE),
    };
}

// Kicks the ring shader draws at once: the shared pipeline's kickSlots (audio/AudioPipeline.qml),
// KICKS in shaders/ring.frag.
export const KICKS = 8;
// Seconds after which a kick has nothing left to draw.
export const PLAYED_OUT = 3;

// The pipeline's last kicks (kickAges/kickPowers/kickSeeds, any order) as the shader's KICKS slots.
// A missing or unusable slot is empty (power 0, long over), and so is a kick that has played out.
export function kickSlots(ages, powers, seeds) {
    const slots = { ages: [], powers: [], seeds: [] };
    for (let i = 0; i < KICKS; i++) {
        const age = ages?.[i], power = powers?.[i];
        const live = Number.isFinite(age) && Number.isFinite(power) && power > 0 && age < PLAYED_OUT;
        slots.ages.push(live ? age : 100);
        slots.powers.push(live ? power : 0);
        slots.seeds.push(live ? (seeds?.[i] ?? 0) : 0);
    }
    return slots;
}

// How far a Shockwave's front strays from round in its soft lobes, as a share of how far it has
// travelled, and how much brighter one side of it is than the other (shockwaveFront()).
export const SHAPE_REACH = 0.12;
export const SHAPE_LIGHT = 0.3;
// Its ragged edge on top of the lobes: how far it strays (as SHAPE_REACH), and how much darker the
// edge flickers at its dimmest.
export const ROUGH_REACH = 0.09;
export const ROUGH_LIGHT = 0.45;
// How wild a Kick's shape is from its power: a soft one's (at SHAPE_SOFT or below) is SHAPE_CALM of
// a hard one's (at SHAPE_HARD or above), so busy tracks stay calm and drops tear the front.
export const SHAPE_CALM = 0.25;
export const SHAPE_SOFT = 0.55;
export const SHAPE_HARD = 0.95;

const TAU = 2 * Math.PI;
const fract = x => x - Math.floor(x);

// How wild a Kick of `power` (0.5..1) shapes its Shockwave, SHAPE_CALM..1.
export function shapeChaos(power) {
    return SHAPE_CALM + (1 - SHAPE_CALM) * smoothstep(SHAPE_SOFT, SHAPE_HARD, power);
}

// A Kick's Shockwave `age` seconds after it fired, in the direction `angle` (radians clockwise from
// 12 o'clock): kickAt()'s front and strength, given the Kick's own shape. Each Kick (its `seed`)
// wobbles in its own few soft lobes and is brighter on one side, and its edge is ragged like a
// flame front, the rags running along it and flickering as it travels; it is born round and
// wobbles more as it travels, and a harder Kick's shape is wilder (shapeChaos()). Without an angle
// it is the round kickAt(). shaders/ring.frag's kickFront() mirrors it.
export function shockwaveFront(age, power, seed, angle) {
    const { front, strength } = kickAt(age, power);
    if (angle === undefined)
        return { front, strength };
    const s = seed ?? 0;
    const chaos = shapeChaos(power);
    const wobble = 0.5 * Math.sin(2 * angle + TAU * fract(s * 0.618034))
                 + 0.35 * Math.sin(3 * angle + TAU * fract(s * 0.754878))
                 + 0.15 * Math.sin(5 * angle + TAU * fract(s * 0.569840));
    const spin = TAU * fract(s * 0.302776);
    const rough = 0.5 * Math.sin(5 * angle + spin)
                + 0.3 * Math.sin(9 * angle - 1.7 * spin + 3 * age)
                + 0.2 * Math.sin(17 * angle + 2.3 * spin - 6 * age);
    const flicker = 1 - ROUGH_LIGHT * chaos * (0.5 - 0.5 * Math.sin(11 * angle - spin + 4 * age));
    const reach = chaos * (SHAPE_REACH * (0.5 + 0.5 * fract(s * 0.414214)) * wobble + ROUGH_REACH * rough);
    return {
        front: KICK_ORIGIN + (front - KICK_ORIGIN) * (1 + reach),
        strength: strength * (1 + SHAPE_LIGHT * Math.sin(angle + TAU * fract(s * 0.819173))) * flicker,
    };
}

// The live Shockwaves among the pipeline's last kicks (`ages`, `powers`, `seeds`, any order): each
// one's age and power, with its front and strength in the direction `angle` (shockwaveFront()).
function shockwaves(ages, powers, seeds, angle) {
    const slots = kickSlots(ages, powers, seeds ?? []);
    const live = [];
    for (let i = 0; i < KICKS; i++) {
        if (slots.powers[i] <= 0)
            continue;
        const age = Math.max(0, slots.ages[i]), power = slots.powers[i];
        // Object.assign, not `{ ...x }`: Qt's JS engine can't parse object spread.
        live.push(Object.assign({ age, power }, shockwaveFront(age, power, slots.seeds[i], angle)));
    }
    return live;
}

// How far ahead of a Shockwave's front, and how far behind it, a radius still feels it crossing,
// in dial radii (shockwaveCrossing()).
export const CROSSING_LEAD = 0.1;
export const CROSSING_TRAIL = 0.3;

const smoothstep = (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
};

// How brightly a Shockwave's front is crossing `radius` (dial radii) right now, 0..1, from the
// pipeline's last kicks (`ages`, `powers`, any order, as kickSlots() takes them). Each Shockwave
// counts with its strength (kickAt()), shaped by how close its front is: nothing until the front
// is within CROSSING_LEAD, full strength as it passes, gone once it is CROSSING_TRAIL beyond.
// Overlapping Shockwaves take the brightest. What the hour points flash by as the wave reaches
// them; shaders/ring.frag's shockwaveCrossing() mirrors it.
// With the kicks' `seeds` and a direction (`angle`, as shockwaveFront()) it follows each Kick's
// shaped front there; without, the round one.
export function shockwaveCrossing(radius, ages, powers, seeds, angle) {
    let crossing = 0;
    for (const { front, strength } of shockwaves(ages, powers, seeds, angle)) {
        const ds = radius - front;  // > 0 ahead of the front, < 0 behind it
        const near = ds >= 0 ? 1 - smoothstep(0, CROSSING_LEAD, ds) : 1 - smoothstep(0, CROSSING_TRAIL, -ds);
        crossing = Math.max(crossing, strength * near);
    }
    return Math.min(1, crossing);
}

// How the ribbons surge where a Shockwave's front crosses them (ribbonSurge()): the front's reach
// either side, a Gaussian's 2σ² in dial radii squared (it falls to a fifth within about 0.1 each
// way), and the lift at full strength, in spectrum level.
export const SURGE_WIDTH = 0.006;
export const SURGE_LIFT = 0.6;

// How much the Shockwaves lift the ribbons at `radius` (dial radii) right now, in spectrum level
// to add to the music's (0 = none), from the pipeline's last kicks (`ages`, `powers`, any order):
// each Shockwave lifts by its strength (kickAt()) where its front is, falling off within about
// 0.1 either side (SURGE_WIDTH). Unlike shockwaveCrossing(), overlapping surges add up, as on
// the bar (shaders/viz.frag). shaders/ring.frag's ribbonSurge() mirrors it.
// `seeds` and `angle` as shockwaveCrossing().
export function ribbonSurge(radius, ages, powers, seeds, angle) {
    let surge = 0;
    for (const { front, strength } of shockwaves(ages, powers, seeds, angle)) {
        const ds = radius - front;
        surge += strength * Math.exp(-ds * ds / SURGE_WIDTH);
    }
    return SURGE_LIFT * surge;
}

// How fast the center punch fades, per second: a punch, gone within a quarter second while the
// Shockwave flies on (centerPunch()).
export const PUNCH_FADE = 15;

// How brightly the center punches right now, 0..1, from the pipeline's last kicks (`ages`,
// `powers`, any order): every Kick punches as its Shockwave is born, at its own power, so a soft
// Kick punches faintly and a hard one strongly, and fades at PUNCH_FADE. Overlapping punches take
// the brightest. shaders/ring.frag's centerPunch() mirrors it.
export function centerPunch(ages, powers) {
    let punch = 0;
    for (const { age, power } of shockwaves(ages, powers))
        punch = Math.max(punch, power * Math.exp(-age * PUNCH_FADE));
    return Math.min(1, punch);
}

// How a Kick pushes the Aura outward (auraPush()): how far at full power, in dial radii, how fast
// the push eases out and how fast it eases back, per second. Slow enough to see, unlike the kick's
// punch; it moves the glow, never brightens it.
export const AURA_PUSH = 0.15;
export const AURA_RISE = 25;
export const AURA_FALL = 4;

// How far the Kicks push the Aura outward right now, 0..1 of AURA_PUSH, from the pipeline's last
// kicks (`ages`, `powers`, any order): every Kick eases it out at AURA_RISE and back at AURA_FALL,
// as far as its power, so a soft Kick pushes less. Overlapping pushes take the farthest.
// shaders/ring.frag's auraPush() mirrors it.
export function auraPush(ages, powers) {
    let push = 0;
    for (const { age, power } of shockwaves(ages, powers))
        push = Math.max(push, power * (1 - Math.exp(-age * AURA_RISE)) * Math.exp(-age * AURA_FALL));
    return Math.min(1, push);
}

// How brightly the hands flash, 0..1, from the same kicks as the Shockwaves: every kick lights them
// at its power and fades at `decay` per second (the kickDecay setting, docs/config.mjs). Overlapping
// kicks take the brightest, so a new hit flashes again.
export function handFlash(ages, powers, decay) {
    const slots = kickSlots(ages, powers, []);
    let flash = 0;
    for (let i = 0; i < KICKS; i++)
        flash = Math.max(flash, slots.powers[i] * Math.exp(-Math.max(0, slots.ages[i]) * decay));
    return Math.min(1, flash);
}

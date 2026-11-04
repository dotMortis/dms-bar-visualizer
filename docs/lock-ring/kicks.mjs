// Kicks on the Lock Ring, apart from drawing: how each one's shockwave grows out of the center,
// and how the hands flash. Plain JS for tests/lock-kicks.test.mjs; shaders/ring.frag mirrors
// kickAt() and has the same constants (tests/lock-constants.test.mjs). The sparks a kick flings
// off the ring are the shader's alone.
// Distances are in dial radii (1 = the dial), ages in seconds, power is the shared detector's
// hit strength (0.5..1, docs/kick.mjs).
import { DIAL_RATIO } from "./ring.mjs";
import { SETTINGS } from "./settings.mjs";

// Where a shockwave starts (a small round at the center; the hands float around it) and the
// widget's edge, in dial radii.
export const KICK_ORIGIN = 0.014 / DIAL_RATIO;
export const EDGE = 0.5 / DIAL_RATIO;
// The hardest hit's shockwave stops here, where the ring's edge fade starts.
export const MAX_REACH = 0.9 * EDGE;
// How fast a shockwave eases out to its reach, and how fast it fades, per second.
export const KICK_GROW = 4.5;
export const KICK_FADE = 2.2;

// A kick `age` seconds after it fired:
//   front     the shockwave's radius: eases out from the center (fast burst, slowing at the edge) to a
//             reach that grows with power
//   strength  how bright the shockwave is, 0..1
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

// The kickDecay setting's default (settings.mjs).
const DEFAULT_DECAY = SETTINGS.find(s => s.key === "kickDecay").default;

// How brightly the hands flash, 0..1, from the same kicks as the shockwaves: every kick lights them
// at its power and fades at `decay` per second (the kickDecay setting). Overlapping kicks take the
// brightest, so a new hit flashes again.
export function handFlash(ages, powers, decay = DEFAULT_DECAY) {
    const slots = kickSlots(ages, powers, []);
    let flash = 0;
    for (let i = 0; i < KICKS; i++)
        flash = Math.max(flash, slots.powers[i] * Math.exp(-Math.max(0, slots.ages[i]) * decay));
    return Math.min(1, flash);
}

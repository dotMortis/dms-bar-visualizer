// Kicks on the Lock Ring, apart from drawing: how each one's shockwave grows out of the center hub,
// how its sparks fly off the ring, and how the hands flash. Plain JS for tests/lock-kicks.test.mjs; shaders/ring.frag mirrors kickAt().
// Distances are in dial radii (1 = the dial), ages in seconds, power is the shared detector's
// hit strength (0.5..1, docs/kick.mjs).

// The hub's radius and the widget's edge, in dial radii (LockRing.qml: hub size*0.014, dial size*0.34).
export const HUB = 0.014 / 0.34;
export const EDGE = 0.5 / 0.34;
// The hardest hit's shockwave stops here, where the ring's edge fade starts.
const MAX_REACH = 0.9 * EDGE;

// A kick `age` seconds after it fired:
//   front     the shockwave's radius: eases out from the hub (fast burst, slowing at the edge) to a
//             reach that grows with power
//   strength  how bright the shockwave is, 0..1
//   sparks    how far out its spray of sparks has flown: from the ring (1) outward, farther on a
//             harder hit. Each spark covers its own share of that.
//   sparkLife how bright the sparks still are, 0..1
export function kickAt(age, power) {
    const reach = HUB + (MAX_REACH - HUB) * power;
    return {
        front: HUB + (reach - HUB) * (1 - Math.exp(-age * 4.5)),
        strength: power * Math.exp(-age * 2.2),
        sparks: 1 + (MAX_REACH - 1) * power * (1 - Math.exp(-age * 3.5)),
        sparkLife: power * Math.exp(-age * 2),
    };
}

// Kicks the ring shader draws at once: the shared pipeline's kickSlots (audio/AudioPipeline.qml),
// KICKS in shaders/ring.frag.
export const KICKS = 8;
// Seconds after which a kick has nothing left to draw.
const PLAYED_OUT = 3;

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

// How brightly the hands flash, 0..1, from the same kicks as the shockwaves: every kick lights them
// at its power and fades at `decay` per second (the pipeline's kickDecay, default 6). Overlapping
// kicks take the brightest, so a new hit flashes again.
export function handFlash(ages, powers, decay = 6) {
    const slots = kickSlots(ages, powers, []);
    let flash = 0;
    for (let i = 0; i < KICKS; i++)
        flash = Math.max(flash, slots.powers[i] * Math.exp(-Math.max(0, slots.ages[i]) * decay));
    return Math.min(1, flash);
}

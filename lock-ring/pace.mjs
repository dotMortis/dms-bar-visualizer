// How often the Lock Ring draws. With something to hear, every frame. In Silence (GLOSSARY.md),
// once the music has played out on the ring and only its breathing idle wave is left, at
// SILENCE_FPS: the wave keeps moving and the clock keeps the time, but a locked, quiet machine is
// nearly idle. The first sound brings every frame back at once. Plain JS for
// tests/lock-pace.test.mjs; LockAudio.qml runs it, for every ring at once.
import { kickSlots } from "./kicks.mjs";

// The frame rate in Silence, frames per second. The idle wave drifts and breathes slowly (ring.mjs
// IDLE), so this still looks smooth; the second hand steps by 0.6 degrees a frame.
export const SILENCE_FPS = 10;

// How close to nothing the ring's motion has to be to count as played out: its presence, swell
// and Kick punch (0..1, or dial radii for the swell), as LockAudio.qml has them.
export const AT_REST = 0.01;

// Whether the music has played out on the ring, leaving only its idle wave: the ribbons faded
// (presence), the ring no longer swollen (swell), the Kick's punch faded (kick), every Shockwave
// played out (kickAges/kickPowers, kicks.mjs kickSlots()) and no Lyric Word moving on its own
// (words, LockAudio.lyricWords: none popping in or dissolving). Paused or without a player
// (`silence`), the words stand still with the song, so shown words don't hold it then.
export function atRest({ presence = 0, swell = 0, kick = 0, kickAges = [], kickPowers = [], words = {}, silence = "" }) {
    const shockwaves = kickSlots(kickAges, kickPowers, []).powers.some(p => p > 0);
    const songStopped = silence === "paused" || silence === "no-player";
    const wordsMoving = !songStopped && Object.values(words ?? {}).some(w => w.popIn < 1 || w.dissolve > 0);
    return presence < AT_REST && swell < AT_REST && kick < AT_REST && !shockwaves && !wordsMoving;
}

// Whether the ring draws at SILENCE_FPS: in Silence (`silence`, the pipeline's case, "" when
// there is something to hear), once it is at rest (`rested`, atRest()).
export function drawsSlowly(silence, rested) {
    return !!silence && rested;
}

// The music the rings show while they draw slowly, in place of the pipeline's outputs (values,
// bass, mid, treble, kick, flow, kickAges, kickPowers, kickSeeds): the music at rest, so nothing
// the pipeline still does below the Silence threshold redraws them between slow frames. No bands
// (`bands` zeros), no Kicks, and the wave's phase held at `heldFlow`, where it was when the ring
// came to rest.
export function restingMusic(bands, heldFlow) {
    return {
        values: new Array(bands).fill(0), bass: 0, mid: 0, treble: 0, kick: 0, flow: heldFlow,
        kickAges: [], kickPowers: [], kickSeeds: [],
    };
}

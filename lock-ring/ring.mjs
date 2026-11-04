// The Lock Ring's look, apart from drawing: where the spectrum sits on the ring, and how the ring
// swells with the music and fades back to the faint dial in silence. Plain JS for
// tests/lock-ring.test.mjs; LockAudio.qml runs the motion, shaders/ring.frag mirrors spectrumAt().

// Position on the spectrum, 0 (lowest band) to 1 (highest), at `angle` clockwise degrees from
// 12 o'clock. Bass at the bottom, highs meeting at the top, the left half mirroring the right.
// bassStretch > 1 spreads the bass over more of the ring, as the bar's bassStretch does; 1 = linear.
export function spectrumAt(angle, bassStretch) {
    const a = ((angle % 360) + 360) % 360;
    const fromBottom = Math.abs(a - 180) / 180;
    return fromBottom ** bassStretch;
}

// How far the ring swells at full scale, as a fraction of the dial radius. Leaves room in the
// widget for the ribbons to bulge outward.
const MAX_SWELL = 0.08;

// Eases `value` toward `target` with time constant `tau` seconds.
const follow = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));

// The ring's motion, stepped once per frame with bass/mid/treble on cava's 0..1 scale:
//   swell     the ring's radius grows by this fraction of the dial radius, following the beat
//   presence  0..1, how strongly the ribbons show: 0 = only the faint dial
export function createRingMotion() {
    let swell = 0, presence = 0;
    return {
        step({ bass, mid, treble }, dt) {
            const energy = 0.5 * bass + 0.3 * mid + 0.2 * treble;
            const swellTarget = MAX_SWELL * energy;
            // Quick up on a hit and quick down after it, so the ring pulses instead of drifting.
            swell = follow(swell, swellTarget, dt, swellTarget > swell ? 0.03 : 0.1);
            // Quiet music still shows the ribbons in full; they fade out slower than they come in,
            // so a short break doesn't blink them off.
            const presenceTarget = Math.min(1, energy * 5);
            presence = follow(presence, presenceTarget, dt, presenceTarget > presence ? 0.06 : 0.3);
            return { swell, presence };
        },
    };
}

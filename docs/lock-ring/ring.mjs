// The Lock Ring's look, apart from drawing: where the spectrum sits on the ring, the ribbon that is
// the dial (a calm, living wave in silence that the music grows into spectrum ribbons that wave
// around the swelling dial, smoothed between the bands), the 12 hour points riding on it, and how
// the ring swells with the music. Plain JS for tests/lock-ring.test.mjs; LockAudio.qml runs the
// motion, shaders/ring.frag mirrors spectrumAt(), spectrumLevel(), ribbonRadius() and hourPoints().

// The dial's radius as a share of the widget's side (LockRing.qml's dialRadius), leaving room
// around it for the ribbons to wave into. ring.frag's DIAL_RATIO.
export const DIAL_RATIO = 0.34;

// Position on the spectrum, 0 (lowest band) to 1 (highest), at `angle` clockwise degrees from
// 12 o'clock. Bass at the bottom, highs meeting at the top, the left half mirroring the right.
// bassStretch > 1 spreads the bass over more of the ring, as the bar's bassStretch does; 1 = linear.
export function spectrumAt(angle, bassStretch) {
    const a = ((angle % 360) + 360) % 360;
    const fromBottom = Math.abs(a - 180) / 180;
    return fromBottom ** bassStretch;
}

// The spectrum's level at s (0 = lowest band .. 1 = highest) across the bands in `values` (32,
// bass first), smoothed with a cubic between them: it passes through every band's value, with no
// corner where one band meets the next, and never overshoots its two bands, so it stays in 0..1.
// Flat at both ends, so the ribbon has no fold where the mirrored halves meet. A monotone cubic
// (Fritsch-Butland): each band's slope is the harmonic mean of its neighbours' steps, 0 at a peak
// or a dip. shaders/ring.frag's spectrum().
export function spectrumLevel(values, s) {
    const n = values.length - 1;
    const f = Math.min(1, Math.max(0, s)) * n;
    const i = Math.min(Math.floor(f), n - 1);
    const t = f - i;
    const at = j => values[Math.max(0, Math.min(j, n))] || 0;
    const slope = j => {
        if (j <= 0 || j >= n) return 0;
        const d0 = at(j) - at(j - 1), d1 = at(j + 1) - at(j);
        return d0 * d1 > 0 ? 2 * d0 * d1 / (d0 + d1) : 0;
    };
    const a = at(i), b = at(i + 1), t2 = t * t, t3 = t2 * t;
    return a * (2 * t3 - 3 * t2 + 1) + slope(i) * (t3 - 2 * t2 + t) + b * (3 * t2 - 2 * t3) + slope(i + 1) * (t3 - t2);
}

// The ribbon in silence: never a fixed circle, but a thin, slow wave around the dial radius.
//   reach   how far it strays from the dial radius, in dial radii
//   drift   how fast its wave drifts around the dial, in turns of phase per second (strand 0)
//   breath  how fast it breathes: its reach swells and eases this many times a second
//   glow    how bright the ribbon is in silence, as a share of its brightness with music
export const IDLE = { reach: 0.035, drift: 0.05, breath: 0.1, glow: 0.4 };

// The ribbon with music, like the bar's: each strand a wave swinging inward and outward around
// the swelling dial.
//   reach   how far a strand swings either way at full level, in dial radii
//   ripple  how much of the treble rides on the wave as a faster ripple
//   round   how far from 6 and 12 o'clock the wave is rounded where the mirrored halves meet,
//           in radians, so they meet level instead of in a V
export const RIBBON = { reach: 0.25, ripple: 0.3, round: 0.25 };

const TAU = 2 * Math.PI;

// How far the wave has come from 6 o'clock at `a` radians from it (0..PI, the same on both sides):
// `a` itself, but rounded within RIBBON.round of either end so it meets its mirror image level.
function unfold(a) {
    const r = RIBBON.round;
    const bend = v => v < r ? (r - v) * (r - v) / (2 * r) : 0;
    return a + bend(a) - bend(Math.PI - a);
}

// The radius of the ribbon's `strand` (0..2) at `angle` clockwise degrees from 12 o'clock, in dial
// radii: the dial (1), swollen by `swell`, waved around by the music (`level`, the spectrum's 0..1
// there, its waves advanced by `flow` and rippled by `treble`), plus the idle wave, which breathes
// and drifts with `time`. Every rate is a multiple of 1/1200 Hz, so the shader's time wrap at
// 1200 s is seamless. shaders/ring.frag's ribbonRadius() mirrors this.
export function ribbonRadius(angle, { level = 0, flow = 0, time = 0, treble = 0, swell = 0, strand = 0 }) {
    const k = strand;
    const theta = (((angle % 360) + 360) % 360) * Math.PI / 180;
    const a = unfold(Math.abs(theta - Math.PI));         // from the bottom, the same on both sides
    const freq = 3 + 2 * k;
    const phase = flow * (1 + 0.5 * k) + 2.1 * k;
    const wave = Math.sin(a * freq - phase) + RIBBON.ripple * treble * Math.sin(a * freq * 2.3 - phase * 1.7);
    const music = RIBBON.reach * level * wave;
    const breath = 0.7 + 0.3 * Math.sin(TAU * IDLE.breath * time + 1.7 * k);
    const idle = IDLE.reach * breath * Math.sin(theta * (3 + k) + TAU * IDLE.drift * (1 + 0.5 * k) * time + 2.1 * k);
    return 1 + swell + music + idle;
}

// The 12 hour points riding on the ribbon, from the shader's inputs: `values` (32 bands),
// flow, time, treble, swell, presence (ring motion), bassStretch, `crossing`: how brightly a
// Shockwave's front is crossing a radius right now (kicks.mjs shockwaveCrossing() on the kicks),
// and `surge`: how much the Shockwaves lift the ribbons at a radius (kicks.mjs ribbonSurge(); both
// passed in, since kicks.mjs imports this module). Each: angle (clockwise degrees from 12
// o'clock), radius (strand 0's there, surged as the ribbon is at its rest radius, 1 + swell) and
// glow (12, 3, 6 and 9 brighter; dimmer in silence; each flashes as a Shockwave's front reaches
// its radius). shaders/ring.frag mirrors this.
export function hourPoints({ values, flow, time, treble, swell, presence, bassStretch, crossing = () => 0, surge = () => 0 }) {
    const points = [];
    const lift = surge(1 + swell);
    for (let i = 0; i < 12; i++) {
        const angle = i * 30;
        const level = Math.min(1, 1.3 * spectrumLevel(values, spectrumAt(angle, bassStretch)) + lift);
        const radius = ribbonRadius(angle, { level, flow, time, treble, swell, strand: 0 });
        points.push({
            angle,
            radius,
            glow: (i % 3 === 0 ? 1 : 0.6) * (0.6 + 0.4 * presence) + 0.8 * crossing(radius),
        });
    }
    return points;
}

// How far the ring swells at full scale, as a fraction of the dial radius. Leaves room in the
// widget for the ribbons to wave outward.
const MAX_SWELL = 0.08;

// Eases `value` toward `target` with time constant `tau` seconds.
const follow = (value, target, dt, tau) => value + (target - value) * (1 - Math.exp(-dt / tau));

// The ring's motion, stepped once per frame with bass/mid/treble on cava's 0..1 scale:
//   swell     the ring's radius grows by this fraction of the dial radius, following the beat
//   presence  0..1, how much music the ribbon shows: 0 = only its calm idle wave
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

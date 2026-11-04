#version 450
// Lock Ring: the Bar Visualizer's neon spectrum ribbons (shaders/viz.frag) bent into a circle, and
// the ribbon is the dial: in silence a thin, faint wave that breathes and drifts around the dial
// radius, never a fixed circle; with music its strands wave around the swelling dial, inward and
// outward with each band's level like the bar's around its center line, mirrored left and right
// with bass at the bottom, and the ring's radius swells with the music's energy. 12 hour points
// ride on it, each flashing as a Shockwave's front reaches it. On every Kick a chromatic Shockwave
// expands from the center, bigger on a harder hit, the center punches as it is born, the ribbons
// surge where the front crosses them and a spray of sparks flies off the ring; up to KICKS of them
// play at once. Nothing shakes, and the Aura doesn't flash: a Kick only pushes it outward a little. On top,
// the clock's three floating hands as neon wave ribbons (hand()): they swing, thicken and glow
// with their bands, and flash and get a small push on every Kick, around a straight axis through the center at the true
// time. LockRing.qml draws only the digital time over it.
// Compile: /usr/lib/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 -o ring.frag.qsb ring.frag
// (install-lock.sh does this).

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;
    float flow;
    float treble;
    float kick;         // 0..1, the last kick's impact, fading at kickDecay (as viz.frag's)
    float swell;        // radius growth, as a fraction of the dial radius
    float presence;     // 0 = silent (the idle ribbon) .. 1 = full ribbons
    float dial;         // the dial's radius, as a fraction of half the item's size
    float intensity;
    float bassStretch;
    float pixel;        // one pixel, in dial radii (for antialiasing)
    float handFlash;    // 0..1, how brightly all hands flash on a kick (kicks.mjs handFlash())
    // The hands (lock-ring/hands.mjs handPoses()), x = hour, y = minute, z = second, w unused.
    // Angles in radians, clockwise from 12 o'clock; everything else in dial radii.
    vec4 handAngle;     // where each hand points: from the time alone (clock.mjs)
    vec4 handInner;     // where the hand starts, from the center: the hands float
    vec4 handLength;    // from the center to the tip
    vec4 handAmp;       // the wave's sideways reach (handLook().amplitude), 0 = straight
    vec4 handWidth;     // the ribbon's thickness
    vec4 handGlow;      // 0..1, the band's level as neon halo and extra strands
    vec4 handPhase;     // how far each hand's wave has travelled, radians (createHandMotion())
    vec4 kickAge0; vec4 kickAge1;      // the last KICKS kicks (any order), lock-ring/kicks.mjs kickSlots()
    vec4 kickPower0; vec4 kickPower1;  // 0 = empty slot
    vec4 kickSeed0; vec4 kickSeed1;
    vec4 b0; vec4 b1; vec4 b2; vec4 b3;
    vec4 b4; vec4 b5; vec4 b6; vec4 b7;
} ubuf;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int KICKS = 8;  // matches kickSlots in audio/AudioPipeline.qml and KICKS in lock-ring/kicks.mjs

// These constants are lock-ring/ring.mjs's, kicks.mjs's and hands.mjs's, checked by
// tests/lock-constants.test.mjs.
// The dial's radius as a share of the item's side (ring.mjs DIAL_RATIO, LockRing.qml's dialRadius).
const float DIAL_RATIO = 0.34;
// In dial radii, as in lock-ring/kicks.mjs: where a Shockwave starts, and how far the hardest hit
// reaches.
const float KICK_ORIGIN = 0.014 / DIAL_RATIO;
const float MAX_REACH = 0.9 * 0.5 / DIAL_RATIO;
// kickAt(): how fast a Shockwave grows and fades, per second, and when a kick has played out.
const float KICK_GROW = 4.5;
const float KICK_FADE = 2.2;
const float PLAYED_OUT = 3.0;
// shockwaveCrossing(): how far ahead of and behind a Shockwave's front a radius feels it crossing.
const float CROSSING_LEAD = 0.1;
const float CROSSING_TRAIL = 0.3;
// ribbonSurge(): how far either side of a Shockwave's front the ribbons surge (a Gaussian's 2σ²,
// in dial radii squared: a fifth within about 0.1), and how much they lift at full strength, in
// spectrum level.
const float SURGE_WIDTH = 0.006;
const float SURGE_LIFT = 0.6;
// centerPunch(): how fast the center punch fades, per second.
const float PUNCH_FADE = 15.0;
// auraPush(): how far a full Kick pushes the Aura outward (dial radii), and how fast it eases out
// and back, per second.
const float AURA_PUSH = 0.15;
const float AURA_RISE = 25.0;
const float AURA_FALL = 4.0;
// shockwaveFront(): how far a Shockwave strays from round in its lobes and its ragged edge, how much
// brighter one side is and how dark the edge flickers, and how wild a Kick's shape is from its
// power (shapeChaos()).
const float SHAPE_REACH = 0.12;
const float SHAPE_LIGHT = 0.3;
const float ROUGH_REACH = 0.09;
const float ROUGH_LIGHT = 0.45;
const float SHAPE_CALM = 0.25;
const float SHAPE_SOFT = 0.55;
const float SHAPE_HARD = 0.95;

float band(int i) {
    int v = i / 4;
    int c = i - v * 4;
    vec4 q = v == 0 ? ubuf.b0 : v == 1 ? ubuf.b1 : v == 2 ? ubuf.b2 : v == 3 ? ubuf.b3
           : v == 4 ? ubuf.b4 : v == 5 ? ubuf.b5 : v == 6 ? ubuf.b6 : ubuf.b7;
    return q[c];
}

float kickAge(int i) { return i < 4 ? ubuf.kickAge0[i] : ubuf.kickAge1[i - 4]; }
float kickPower(int i) { return i < 4 ? ubuf.kickPower0[i] : ubuf.kickPower1[i - 4]; }
float kickSeed(int i) { return i < 4 ? ubuf.kickSeed0[i] : ubuf.kickSeed1[i - 4]; }

// How wild a Kick of `power` shapes its Shockwave, SHAPE_CALM..1 (lock-ring/kicks.mjs shapeChaos()).
float shapeChaos(float power) {
    return SHAPE_CALM + (1.0 - SHAPE_CALM) * smoothstep(SHAPE_SOFT, SHAPE_HARD, power);
}

// Kick j's Shockwave right now in the direction theta (radians clockwise from 12 o'clock):
// x = its front's radius (dial radii), y = its strength. A strength of 0 is an empty or played-out
// slot. Each Kick (its seed) wobbles in its own soft lobes and is brighter on one side, and its
// edge is ragged like a flame front, flickering as it travels; born round, it wobbles more as it
// travels, wilder on a harder Kick (lock-ring/kicks.mjs kickAt() and shockwaveFront()).
vec2 kickFront(int j, float theta) {
    float age = max(kickAge(j), 0.0);
    float power = kickPower(j);
    if (power <= 0.0 || age >= PLAYED_OUT)
        return vec2(0.0);
    float reach = KICK_ORIGIN + (MAX_REACH - KICK_ORIGIN) * power;
    float front = KICK_ORIGIN + (reach - KICK_ORIGIN) * (1.0 - exp(-age * KICK_GROW));
    float strength = power * exp(-age * KICK_FADE);
    float sd = kickSeed(j);
    float wobble = 0.5 * sin(2.0 * theta + TAU * fract(sd * 0.618034))
                 + 0.35 * sin(3.0 * theta + TAU * fract(sd * 0.754878))
                 + 0.15 * sin(5.0 * theta + TAU * fract(sd * 0.569840));
    float chaos = shapeChaos(power);
    float spin = TAU * fract(sd * 0.302776);
    float rough = 0.5 * sin(5.0 * theta + spin)
                + 0.3 * sin(9.0 * theta - 1.7 * spin + 3.0 * age)
                + 0.2 * sin(17.0 * theta + 2.3 * spin - 6.0 * age);
    float flicker = 1.0 - ROUGH_LIGHT * chaos * (0.5 - 0.5 * sin(11.0 * theta - spin + 4.0 * age));
    float stray = chaos * (SHAPE_REACH * (0.5 + 0.5 * fract(sd * 0.414214)) * wobble + ROUGH_REACH * rough);
    return vec2(KICK_ORIGIN + (front - KICK_ORIGIN) * (1.0 + stray),
                strength * (1.0 + SHAPE_LIGHT * sin(theta + TAU * fract(sd * 0.819173))) * flicker);
}

// How brightly a Shockwave's front is crossing radius r (dial radii) right now, 0..1: each Kick's
// strength, shaped by how near its front is; the brightest wins. lock-ring/kicks.mjs
// shockwaveCrossing(), in the direction theta.
float shockwaveCrossing(float r, float theta) {
    float crossing = 0.0;
    for (int j = 0; j < KICKS; j++) {
        vec2 kf = kickFront(j, theta);
        float ds = r - kf.x;                  // > 0 ahead of the front, < 0 behind it
        float near = ds >= 0.0 ? 1.0 - smoothstep(0.0, CROSSING_LEAD, ds) : 1.0 - smoothstep(0.0, CROSSING_TRAIL, -ds);
        crossing = max(crossing, kf.y * near);
    }
    return min(crossing, 1.0);
}

// How much the Shockwaves lift the ribbons at radius r (dial radii) right now, in spectrum level:
// each Kick's strength where its front is, falling off within about 0.1 either side; overlapping
// surges add up, as viz.frag's. lock-ring/kicks.mjs ribbonSurge(), in the direction theta.
float ribbonSurge(float r, float theta) {
    float surge = 0.0;
    for (int j = 0; j < KICKS; j++) {
        vec2 kf = kickFront(j, theta);
        float ds = r - kf.x;
        surge += kf.y * exp(-ds * ds / SURGE_WIDTH);
    }
    return SURGE_LIFT * surge;
}

// How far the Kicks push the Aura outward right now, 0..1 of AURA_PUSH: every Kick eases it out
// and back, as far as its power; the farthest wins. lock-ring/kicks.mjs auraPush().
float auraPush() {
    float push = 0.0;
    for (int j = 0; j < KICKS; j++) {
        float age = max(kickAge(j), 0.0);
        float power = kickPower(j);
        if (power > 0.0 && age < PLAYED_OUT)
            push = max(push, power * (1.0 - exp(-age * AURA_RISE)) * exp(-age * AURA_FALL));
    }
    return min(push, 1.0);
}

// How brightly the center punches right now, 0..1: every Kick as its Shockwave is born, at its own
// power, fading fast; the brightest wins. lock-ring/kicks.mjs centerPunch().
float centerPunch() {
    float punch = 0.0;
    for (int j = 0; j < KICKS; j++) {
        float age = max(kickAge(j), 0.0);
        float power = kickPower(j);
        if (power > 0.0 && age < PLAYED_OUT)
            punch = max(punch, power * exp(-age * PUNCH_FADE));
    }
    return min(punch, 1.0);
}

float hash1(float n) {
    return fract(sin(n * 12.9898) * 43758.5453);
}

// Band i's slope in the smoothed spectrum: the harmonic mean of its neighbours' steps, 0 at a
// peak, a dip or either end (ring.mjs spectrumLevel()).
float bandSlope(int i) {
    if (i <= 0 || i >= 31)
        return 0.0;
    float d0 = band(i) - band(i - 1);
    float d1 = band(i + 1) - band(i);
    return d0 * d1 > 0.0 ? 2.0 * d0 * d1 / (d0 + d1) : 0.0;
}

// Spectrum at s in [0,1] (0 = bass) across 32 bands, smoothed with a monotone cubic between
// them: through every band's value, no corners, within 0..1. lock-ring/ring.mjs spectrumLevel().
float spectrum(float s) {
    float f = clamp(s, 0.0, 1.0) * 31.0;
    int i = min(int(floor(f)), 30);
    float t = f - float(i);
    float t2 = t * t;
    float t3 = t2 * t;
    return band(i) * (2.0 * t3 - 3.0 * t2 + 1.0) + bandSlope(i) * (t3 - 2.0 * t2 + t)
         + band(i + 1) * (3.0 * t2 - 2.0 * t3) + bandSlope(i + 1) * (t3 - t2);
}

// Catppuccin Mocha, lavender-led, as in viz.frag.
const vec3 LAVENDER = vec3(0.706, 0.745, 0.996); // #b4befe
const vec3 MAUVE    = vec3(0.796, 0.651, 0.969); // #cba6f7
const vec3 PINK     = vec3(0.961, 0.761, 0.906); // #f5c2e7
const vec3 BLUE     = vec3(0.537, 0.706, 0.980); // #89b4fa

// --- The ribbon: the dial, a living wave ---------------------------------------------------
// IDLE in lock-ring/ring.mjs; ribbonRadius() mirrors its ribbonRadius().
const float IDLE_REACH = 0.035;
const float IDLE_DRIFT = 0.05;
const float IDLE_BREATH = 0.1;
const float IDLE_GLOW = 0.4;
// RIBBON in lock-ring/ring.mjs: the music's wave, its treble ripple, and the rounding at 6 and 12.
const float RIBBON_REACH = 0.25;
const float RIBBON_RIPPLE = 0.3;
const float RIBBON_ROUND = 0.25;
const float POINT_SIZE = 0.013;  // an hour point's core radius, in dial radii
// The Shockwave's beads (the shader's alone): how many ride its front row on a soft and on a hard
// Kick, and how many places either side of its own angle a pixel looks at.
const float BEADS_SOFT = 45.0;
const float BEADS_HARD = 64.0;
const int BEAD_NEAR = 2;

// How far the wave has come from 6 o'clock at a radians from it, rounded within RIBBON_ROUND of
// either end so the mirrored halves meet level (ring.mjs unfold()).
float foldBend(float v) {
    return v < RIBBON_ROUND ? (RIBBON_ROUND - v) * (RIBBON_ROUND - v) / (2.0 * RIBBON_ROUND) : 0.0;
}

float unfold(float a) {
    return a + foldBend(a) - foldBend(PI - a);
}

// Strand k's radius at theta (clockwise from 12 o'clock, radians), in dial radii: the swelling
// base, the music's wave around it (level, 0..1), and the idle wave that breathes and drifts with
// time.
float ribbonRadius(float theta, float level, int k) {
    float fk = float(k);
    float a = unfold(abs(theta - PI));
    float freq = 3.0 + 2.0 * fk;
    float phase = ubuf.flow * (1.0 + 0.5 * fk) + 2.1 * fk;
    float wave = sin(a * freq - phase) + RIBBON_RIPPLE * ubuf.treble * sin(a * freq * 2.3 - phase * 1.7);
    float music = RIBBON_REACH * level * wave;
    float breath = 0.7 + 0.3 * sin(TAU * IDLE_BREATH * ubuf.time + 1.7 * fk);
    float idle = IDLE_REACH * breath * sin(theta * (3.0 + fk) + TAU * IDLE_DRIFT * (1.0 + 0.5 * fk) * ubuf.time + 2.1 * fk);
    return 1.0 + ubuf.swell + music + idle;
}

vec3 palette(float h) {
    float f = fract(h) * 6.0;
    int i = int(floor(f));
    float m = smoothstep(0.0, 1.0, fract(f));
    vec3 c[7] = vec3[7](LAVENDER, MAUVE, LAVENDER, PINK, LAVENDER, BLUE, LAVENDER);
    return mix(c[i], c[i + 1], m);
}

vec3 pal(float h, float s, float v) {
    return v * pow(palette(h), vec3(1.0 + 1.5 * s));
}

// The ribbons' light at dp pixels from a strand's centre, at a level of 0..1 (louder = brighter)
// and a kick of 0..1 (wider): viz.frag's glow, measured in pixels so it looks the same at any ring
// size. RIBBON_FALLOFF sets how fast it falls off: softer than the bar's 1.125 (viz.frag's 18 / glowW
// over its 40 px bar, half bright at ~0.9 px, a hard line on a ring), sharper than the old glow that
// grew with the ring (~3 px at the default size): half bright at ~1.8 px, neon with a defined core.
const float RIBBON_FALLOFF = 0.3;
float ribbonLight(float dp, float level, float kick) {
    return 1.0 / (1.0 + dp * dp * RIBBON_FALLOFF / (1.0 + 3.0 * kick)) * (0.6 + 1.8 * level) * 0.7;
}

// --- Hands: neon wave ribbons ----------------------------------------------------------------
// Each hand is a ribbon of HAND_STRANDS strands, like viz.frag's, whose centrelines undulate
// sideways around the hand's straight axis in a wave travelling out to the tip. The axis runs
// through the center at the true time (handAngle), but the hand floats: it starts at handInner,
// so the hands never meet at the center. The wave starts at nothing at the inner end and leaves
// the tip by the axis (waveEnvelope()). In silence (handAmp 0, handGlow 0) the strands collapse
// into one plain line. Uses the uniforms handAngle, handInner, handLength, handAmp, handWidth,
// handGlow, handPhase, handFlash, pixel, plus time and treble.
//
// WAVE in lock-ring/hands.mjs; waveEnvelope() and waveOffset() mirror it.
const float WAVE_PERIODS = 1.5;
const float WAVE_RISE = 0.3;
const float WAVE_FALL = 0.35;
const float WAVE_TIP = 0.12;
const float WAVE_RIPPLE = 0.15;
const int HAND_STRANDS = 3;
const float HALO_END = 0.35;  // where a hand's glow has faded out, in dial radii from a strand

float waveEnvelope(float u) {
    float fall = smoothstep(1.0 - WAVE_FALL, 1.0, u);
    return smoothstep(0.0, WAVE_RISE, u) * (1.0 + (WAVE_TIP - 1.0) * fall);
}

float waveOffset(float u, float phase, float amplitude, float treble) {
    float tr = clamp(treble, 0.0, 1.0) * WAVE_RIPPLE;
    float x = TAU * WAVE_PERIODS * u;
    float wave = (1.0 - tr) * sin(x - phase) + tr * sin(x * 2.3 - phase * 1.7);
    return amplitude * waveEnvelope(u) * wave;
}

// One hand at q (dial radii, y down) in `color`: emissive light to add.
vec3 hand(vec2 q, float index, float angle, float inner, float len, float amp, float width, float glow, float wave, vec3 color) {
    vec2 dir = vec2(sin(angle), -cos(angle));  // center to tip
    vec2 side = vec2(cos(angle), sin(angle));  // to the hand's right
    float along = dot(q, dir);
    float across = dot(q, side);
    // Cheap reject: past the hand's reach (its length, swing and halo, which ends at HALO_END).
    if (along < inner - HALO_END || along > len + HALO_END || abs(across) > amp + width + HALO_END)
        return vec3(0.0);
    float span = len - inner;
    float u = (along - inner) / span;
    float uc = clamp(u, 0.0, 1.0);
    float flash = ubuf.handFlash;
    float tr = ubuf.treble;
    vec3 col = vec3(0.0);
    for (int k = 0; k < HAND_STRANDS; k++) {
        float fk = float(k);
        // Strands drift apart with the band: each its own speed, phase and reach. The wave runs
        // at the hand's own band's pace (wave, hands.mjs createHandMotion()); its multiples here
        // keep it seamless where it wraps (PHASE_WRAP).
        float phase = wave * (1.0 + 0.5 * fk) + fk * 2.1 + index * 1.3;
        float a = amp * (1.0 - 0.22 * fk);
        float y = waveOffset(uc, phase, a, tr);
        float d;
        if (u > 0.0 && u < 1.0) {
            // Distance across the strand, corrected for its slope so steep stretches stay as thick.
            float e = 0.01;
            float slope = (waveOffset(uc + e, phase, a, tr) - waveOffset(uc - e, phase, a, tr)) / (2.0 * e * span);
            d = abs(across - y) / sqrt(1.0 + slope * slope);
        } else {
            d = length(vec2(along - inner - uc * span, across - y));  // round caps at both ends
        }
        // Lit like the ribbons (ribbonLight()), so the hands have the ring's colors and
        // brightness: the main strand is the hand, a solid line as thick as the hand with the
        // ribbons' falloff around it; the others are hairlines that come in with the band and the
        // kick. Brighter and wider with the band and the kick flash, as the ribbons are with theirs.
        float main = k == 0 ? 1.0 : 0.0;
        float weight = mix(clamp(glow + flash, 0.0, 1.0) * (0.6 - 0.15 * fk), 1.0, main);
        float w = width * 0.5 * main;                              // the solid line's half thickness
        float dp = max(d - w, 0.0) / ubuf.pixel;
        vec3 c = mix(pow(color, vec3(1.0 + 1.5 * 0.9)), pal(ubuf.time * 0.05 + index * 0.33 + fk * 0.2, 0.9, 1.0), 0.3 * fk);
        col += weight * c * ribbonLight(dp, clamp(glow + flash, 0.0, 1.0), ubuf.kick + flash);
    }
    return col;
}

void main() {
    vec2 p = qt_TexCoord0 * 2.0 - 1.0;   // -1..1 across the item, y down
    float edge = length(p);              // 1 = the item's inscribed circle
    float r = edge / ubuf.dial;          // in dial radii: 1 = the dial
    // Angle from the bottom, 0 at 6 o'clock to PI at 12, the same on both sides.
    float a = atan(abs(p.x), p.y);
    // Where on the spectrum this angle sits: spectrumAt() in lock-ring/ring.mjs.
    float s = pow(a / PI, ubuf.bassStretch);
    float base = 1.0 + ubuf.swell;
    // The music's level here, before any Shockwave lifts it. Each strand surges where it sits
    // before the surge (ribbonSurge() there), so the flare travels out across the strands with the
    // front; overlapping Kicks add up.
    float music = 1.3 * spectrum(s) * (1.0 + 0.7 * ubuf.kick);
    float calm = min(1.0, music);
    float t = ubuf.time;
    float hueBase = t * 0.05 + s * 0.15;
    vec2 q = p / ubuf.dial;              // in dial radii, y down
    // No plasma haze, unlike viz.frag: a wash across the whole dial on every Kick is too much here.
    vec3 col = vec3(0.0);

    // Clockwise from 12 o'clock, 0..TAU: the idle wave runs all the way round.
    float theta = atan(p.x, -p.y);
    if (theta < 0.0)
        theta += TAU;

    // --- The ribbon: the dial itself --------------------------------------------------------
    // Neon strands like the bar's. In silence they idle as a thin, faint, breathing wave around the
    // dial radius; music grows them into the spectrum ribbons, which wave around the swelling dial,
    // inward and outward, their waves travelling around the ring from the bottom up, advanced by
    // audio energy (ubuf.flow): loud = racing, quiet = crawling.
    // Lit with viz.frag's glow (ribbonLight()), a little softer: a neon line with a defined core,
    // the same at any ring size, wider on a kick.
    vec3 ribbon = vec3(0.0);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float surge = ribbonSurge(ribbonRadius(theta, calm, k), theta);
        float level = min(1.0, music + surge);
        float rr = ribbonRadius(theta, level, k);
        // Across the strand, not along the radius, so steep stretches stay as thin.
        float e = 0.002;
        float slope = (ribbonRadius(theta + e, level, k) - ribbonRadius(theta - e, level, k)) / (2.0 * e * max(r, 0.05));
        float d = (r - rr) / sqrt(1.0 + slope * slope) / ubuf.pixel;
        vec3 c = pal(hueBase + fk * 0.33 + s * 0.6 + level * 0.2, 0.9, 1.0);
        ribbon += c * ribbonLight(d, level, ubuf.kick + surge);  // wider where it surges
    }
    col += ribbon * mix(IDLE_GLOW, 1.0, ubuf.presence);

    // --- Spectrum Aura: a soft fill both ways from the ribbon's living spine, with the music only
    // The music's level without any Kick: no kick punch, no Shockwave surge, so it never flashes.
    // A Kick only pushes the whole glow outward a little and eases it back (auraPush()).
    // From the spine, not a fixed circle, so nothing about the dial stands still. Symmetric:
    // brightest at the spine, with the same music-driven reach inward as outward, so there is no
    // inner edge. It reaches as far as the strands swing at this level (RIBBON_REACH, with the
    // treble's ripple), filling the ribbon's swing; the hands and the time stay clear of it.
    float off = abs(r - ribbonRadius(theta, 0.0, 0) - AURA_PUSH * auraPush());
    float amp = min(1.0, 1.3 * spectrum(s));
    float aura = smoothstep(RIBBON_REACH * (1.0 + RIBBON_RIPPLE * ubuf.treble) * amp + 0.02, 0.0, off);
    // Added after the kick's punch below, which would brighten it with every Kick.
    vec3 auraCol = pal(hueBase + 0.5 + s * 0.8, 0.8, 1.0) * aura * amp * 0.45 * ubuf.presence;

    // --- Kick Shockwaves: a chromatic ring expanding from the center, one per Kick ---------------
    // kickFront(): front and strength (blast). A wide, soft front in lavender, mauve and blue, and
    // a bright wake filling in behind it.
    vec3 wakeCol = pal(hueBase + 0.3, 0.9, 1.0);
    for (int j = 0; j < KICKS; j++) {
        vec2 kf = kickFront(j, theta);
        float blast = kf.y;
        if (blast <= 0.0)
            continue;
        float ds = r - kf.x;                  // > 0 ahead of the front, < 0 behind it
        float eL = exp(-ds * ds / 0.0024);
        float eM = exp(-(ds + 0.05) * (ds + 0.05) / 0.0024);
        float eB = exp(-(ds + 0.1) * (ds + 0.1) / 0.0024);
        col += (pow(LAVENDER, vec3(1.6)) * eL + pow(MAUVE, vec3(2.0)) * eM * 0.85 + pow(BLUE, vec3(2.0)) * eB * 0.75)
               * blast * 1.1;
        float wake = ds < 0.0 && r > KICK_ORIGIN ? exp(ds * 4.0) : 0.0;
        col += wakeCol * wake * blast * 0.35;
    }

    // --- Shockwave beads: beads of light riding each front ---------------------------------------
    // The shader's own: rows of beads in the front's colors, lavender on the front and mauve and
    // blue trailing it as its three bands do, riding its ragged shape (kickFront()) and lit by its
    // strength there. Evenly spaced round with a little jitter, a fixed number per row, so they
    // spread apart as the ring grows and it ends as loose points; each with its own size, flicker
    // and life. More, bigger and looser on a harder Kick (shapeChaos()). Each pixel looks only at
    // the beads within BEAD_NEAR places of its own angle.
    for (int j = 0; j < KICKS; j++) {
        vec2 kf = kickFront(j, theta);
        if (kf.y <= 0.0 || abs(r - kf.x + 0.05) > 0.2)
            continue;                         // away from this ring: past its rows and the beads' glow
        float age = max(kickAge(j), 0.0);
        float sd = kickSeed(j);
        float chaos = shapeChaos(kickPower(j));
        float spin = TAU * fract(sd * 0.302776);
        for (int row = 0; row < 3; row++) {
            float fr = float(row);
            vec3 tint = row == 0 ? pow(LAVENDER, vec3(1.6)) : row == 1 ? pow(MAUVE, vec3(2.0)) : pow(BLUE, vec3(2.0));
            float count = floor((BEADS_SOFT + (BEADS_HARD - BEADS_SOFT) * chaos) * (1.0 - 0.25 * fr));
            float turn = spin + fr * 0.37;
            float here = floor(fract((theta - turn) / TAU) * count);
            for (int n = -BEAD_NEAR; n <= BEAD_NEAR; n++) {
                float i = mod(here + float(n), count);
                float seed = sd * 13.1 + fr * 101.0 + i * 2.93;
                float h1 = hash1(seed), h2 = hash1(seed + 1.3), h3 = hash1(seed + 2.9), h4 = hash1(seed + 4.7);
                float th = (i + 0.5 + 0.8 * (h1 - 0.5)) / count * TAU + turn;
                vec2 bf = kickFront(j, th);
                float rb = bf.x * (1.0 + (h2 - 0.5) * 0.05 * (0.5 + chaos)) - 0.05 * fr;
                vec2 d = q - rb * vec2(sin(th), -cos(th));
                float size = mix(0.007, 0.018, h3 * h3) * (0.75 + 0.5 * chaos);
                float d2 = dot(d, d) / (size * size);
                float life = bf.y * exp(-age * 1.5 * h4) * (1.0 - 0.15 * fr);
                float twinkle = 0.75 + 0.25 * sin(age * 30.0 + h4 * 20.0);
                vec3 c = mix(tint, pal(hueBase + h1 * 0.4, 0.85, 1.0), 0.3);
                col += c * (exp(-d2) * 1.2 + 0.12 * exp(-d2 * 0.12)) * life * twinkle;
            }
        }
    }

    // --- Kick sparks: a spray flung off the ring, streaking outward, one per kick ---------------
    // The shader's own: each spark flies from the swelling ring out to its share of the hardest
    // hit's reach (MAX_REACH), farther on a harder hit, and burns out within 2 s.
    for (int j = 0; j < KICKS; j++) {
        float age = kickAge(j);
        float power = kickPower(j);
        if (power <= 0.0 || age >= 2.0)
            continue;
        float ease = exp(-age * 3.5);
        float spread = (MAX_REACH - 1.0) * power;
        for (int i = 0; i < 24; i++) {
            float seed = kickSeed(j) * 31.7 + float(i) * 7.13;
            float r1 = hash1(seed);
            float r2 = hash1(seed + 1.7);
            float r3 = hash1(seed + 3.1);
            float share = 0.25 + 0.75 * r3;  // each spark's share of the spray's reach
            float th = r1 * TAU;
            vec2 dir = vec2(sin(th), -cos(th));
            float rs = base + spread * share * (1.0 - ease);
            float speed = spread * share * 3.5 * ease;
            vec2 d = q - dir * rs;
            float along = dot(d, dir);       // > 0 ahead of the spark, < 0 on its trail
            float across = d.x * dir.y - d.y * dir.x;
            float trail = clamp(speed * 0.06, 0.008, 0.12);
            float d2 = along * along / (along > 0.0 ? 0.00015 : trail * trail + 0.00015) + across * across / 0.00015;
            float life = power * exp(-age * (1.4 + 1.2 * r2));
            float twinkle = 0.75 + 0.25 * sin(age * 40.0 + r3 * 20.0);
            col += pal(r1 * 0.5 + r2 * 0.5 + hueBase, 0.8, 1.0) * exp(-d2) * life * twinkle * 1.2;
        }
    }

    // --- Hands: lit like the ribbons, so they share the ring's color and brightness ---------------
    // Second on top of minute on top of hour; light adds, as in the ribbons.
    col += hand(q, 0.0, ubuf.handAngle.x, ubuf.handInner.x, ubuf.handLength.x, ubuf.handAmp.x, ubuf.handWidth.x, ubuf.handGlow.x, ubuf.handPhase.x, LAVENDER);
    col += hand(q, 1.0, ubuf.handAngle.y, ubuf.handInner.y, ubuf.handLength.y, ubuf.handAmp.y, ubuf.handWidth.y, ubuf.handGlow.y, ubuf.handPhase.y, MAUVE);
    col += hand(q, 2.0, ubuf.handAngle.z, ubuf.handInner.z, ubuf.handLength.z, ubuf.handAmp.z, ubuf.handWidth.z, ubuf.handGlow.z, ubuf.handPhase.z, PINK);

    // The center punch: a white-lavender flash at the center as each Shockwave is born, as
    // viz.frag's, at that Kick's own power: faint on a soft Kick, strong on a hard one
    // (centerPunch()).
    col += mix(LAVENDER, vec3(1.0), 0.5) * centerPunch() * 0.35 * smoothstep(0.5, 0.0, r);

    // The kick's punch, and the intensity, on everything but the hour points, as viz.frag's; the
    // Aura takes only the intensity.
    col *= 1.0 + 0.4 * ubuf.kick;
    col += auraCol;
    col *= ubuf.intensity;

    // --- Hour points, riding on the ribbon (hourPoints() in lock-ring/ring.mjs) -----------------
    // Clock marks, so at full brightness whatever the intensity. Each surges as its strand does,
    // and flashes as a Shockwave's front reaches its radius (shockwaveCrossing()), not at the
    // Kick's instant.
    for (int i = 0; i < 12; i++) {
        float th = float(i) * TAU / 12.0;
        float ai = abs(th - PI);
        float pm = 1.3 * spectrum(pow(ai / PI, ubuf.bassStretch));
        // Skip a point too far from this pixel to light it, before asking the Shockwaves about it:
        // its halo ends 0.2 from it, and its surge moves it at most a full swing of the ribbon.
        vec2 calmAt = ribbonRadius(th, min(1.0, pm), 0) * vec2(sin(th), -cos(th));
        if (length(q - calmAt) > 0.2 + RIBBON_REACH * (1.0 + RIBBON_RIPPLE))
            continue;
        float level = min(1.0, pm + ribbonSurge(ribbonRadius(th, min(1.0, pm), 0), th));
        float ri = ribbonRadius(th, level, 0);
        vec2 at = ri * vec2(sin(th), -cos(th));
        float quarter = i - (i / 3) * 3 == 0 ? 1.0 : 0.0;
        float hit = shockwaveCrossing(ri, th);
        float glow = mix(0.6, 1.0, quarter) * (0.6 + 0.4 * ubuf.presence) + 0.8 * hit;
        vec2 dq = q - at;
        float d2 = dot(dq, dq);
        float core = exp(-d2 / (POINT_SIZE * POINT_SIZE));
        float halo = 1.0 / (1.0 + d2 / (POINT_SIZE * POINT_SIZE * 9.0)) * smoothstep(0.2, 0.05, sqrt(d2));
        vec3 c = mix(LAVENDER, vec3(1.0), 0.35 * quarter + 0.3 * hit);
        col += (c * core * 1.1 + pow(LAVENDER, vec3(2.0)) * halo * 0.25) * glow;
    }

    col = col / (1.0 + col * 0.35);                   // soft tone-map, as in viz.frag

    // Emissive, premultiplied: alpha follows brightness. Fades out before the item's edge.
    float mask = smoothstep(1.0, 0.9, edge) * ubuf.qt_Opacity;
    float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    fragColor = vec4(col, alpha) * mask;
}

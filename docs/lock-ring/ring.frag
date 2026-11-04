#version 450
// Lock Ring: the Bar Visualizer's neon spectrum ribbons (shaders/viz.frag) bent into a circle, and
// the ribbon is the dial: in silence a thin, faint wave that breathes and drifts around the dial
// radius, never a fixed circle; music grows it outward with each band's level, mirrored left and
// right with bass at the bottom, and the ring's radius swells with the music's energy. 12 hour
// points ride on it, each flashing as a shockwave's front reaches it. On every Kick a chromatic shockwave expands from the center, bigger on a
// harder hit, and a spray of sparks flies off the ring; up to KICKS of them play at once. On top,
// the clock's three floating hands as neon wave ribbons (hand()): they swing, thicken and glow with
// their bands and whip on every Kick, around a straight axis through the center at the true time.
// LockRing.qml draws only the digital time over it.
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
// In dial radii, as in lock-ring/kicks.mjs: where a shockwave starts, and how far the hardest hit reaches.
const float KICK_ORIGIN = 0.014 / DIAL_RATIO;
const float MAX_REACH = 0.9 * 0.5 / DIAL_RATIO;
// kickAt(): how fast a shockwave grows and fades, per second, and when a kick has played out.
const float KICK_GROW = 4.5;
const float KICK_FADE = 2.2;
const float PLAYED_OUT = 3.0;
// shockwaveCrossing(): how far ahead of and behind a shockwave's front a radius feels it crossing.
const float CROSSING_LEAD = 0.1;
const float CROSSING_TRAIL = 0.3;

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

// How brightly a shockwave's front is crossing radius r (dial radii) right now, 0..1: each kick's
// strength, shaped by how near its front is; the brightest wins. lock-ring/kicks.mjs
// shockwaveCrossing().
float shockwaveCrossing(float r) {
    float crossing = 0.0;
    for (int j = 0; j < KICKS; j++) {
        float age = max(kickAge(j), 0.0);
        float power = kickPower(j);
        if (power <= 0.0 || age >= PLAYED_OUT)
            continue;
        float reach = KICK_ORIGIN + (MAX_REACH - KICK_ORIGIN) * power;
        float front = KICK_ORIGIN + (reach - KICK_ORIGIN) * (1.0 - exp(-age * KICK_GROW));
        float ds = r - front;                 // > 0 ahead of the front, < 0 behind it
        float near = ds >= 0.0 ? 1.0 - smoothstep(0.0, CROSSING_LEAD, ds) : 1.0 - smoothstep(0.0, CROSSING_TRAIL, -ds);
        crossing = max(crossing, power * exp(-age * KICK_FADE) * near);
    }
    return min(crossing, 1.0);
}

float hash1(float n) {
    return fract(sin(n * 12.9898) * 43758.5453);
}

// Spectrum at s in [0,1] (0 = bass), linearly interpolated across 32 bands.
float spectrum(float s) {
    float f = clamp(s, 0.0, 1.0) * 31.0;
    int i = int(floor(f));
    return mix(band(i), band(min(i + 1, 31)), fract(f));
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
const float POINT_SIZE = 0.013;  // an hour point's core radius, in dial radii

// Strand k's radius at theta (clockwise from 12 o'clock, radians), in dial radii: the swelling
// base, the music's bulge (level, 0..1), and the idle wave that breathes and drifts with time.
float ribbonRadius(float theta, float level, int k) {
    float fk = float(k);
    float a = abs(theta - PI);
    float freq = 3.0 + 2.0 * fk;
    float phase = ubuf.flow * (1.0 + 0.5 * fk) + 2.1 * fk;
    float wave = 0.5 + 0.5 * sin(a * freq - phase) + 0.15 * sin(a * freq * 2.3 - phase * 1.7) * ubuf.treble;
    float music = 0.32 * level * clamp(wave, 0.0, 1.2);
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
// and a kick of 0..1 (wider): viz.frag's glow, measured in pixels so the line is as crisp as the
// bar's at any ring size. 1.125 = viz.frag's 18 / glowW over its 40 px bar.
float ribbonLight(float dp, float level, float kick) {
    return 1.0 / (1.0 + dp * dp * 1.125 / (1.0 + 3.0 * kick)) * (0.6 + 1.8 * level) * 0.7;
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
    float amp = min(1.0, 1.3 * spectrum(s) * (1.0 + 0.7 * ubuf.kick));
    float base = 1.0 + ubuf.swell;
    float t = ubuf.time;
    float hueBase = t * 0.05 + s * 0.15;
    vec2 q = p / ubuf.dial;              // in dial radii, y down

    vec3 col = vec3(0.0);

    // Clockwise from 12 o'clock, 0..TAU: the idle wave runs all the way round.
    float theta = atan(p.x, -p.y);
    if (theta < 0.0)
        theta += TAU;

    // --- The ribbon: the dial itself --------------------------------------------------------
    // Neon strands like the bar's. In silence they idle as a thin, faint, breathing wave around the
    // dial radius; music grows them into the spectrum ribbons, their waves travelling around the
    // ring from the bottom up, advanced by audio energy (ubuf.flow): loud = racing, quiet = crawling.
    // Lit with viz.frag's glow (ribbonLight()): the same crisp line with a soft falloff as the bar's
    // at any ring size, wider on a kick.
    vec3 ribbon = vec3(0.0);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float rr = ribbonRadius(theta, amp, k);
        // Across the strand, not along the radius, so steep stretches stay as thin.
        float e = 0.002;
        float slope = (ribbonRadius(theta + e, amp, k) - ribbonRadius(theta - e, amp, k)) / (2.0 * e * max(r, 0.05));
        float d = (r - rr) / sqrt(1.0 + slope * slope) / ubuf.pixel;
        vec3 c = pal(hueBase + fk * 0.33 + s * 0.6 + amp * 0.2, 0.9, 1.0);
        ribbon += c * ribbonLight(d, amp, ubuf.kick);
    }
    col += ribbon * mix(IDLE_GLOW, 1.0, ubuf.presence);

    // --- Spectrum aura: a soft fill outward from the ribbon's living spine, with the music only ---
    // From the spine, not a fixed circle, so nothing about the dial stands still.
    float out_ = r - ribbonRadius(theta, 0.0, 0);
    float aura = out_ >= 0.0 ? smoothstep(0.32 * amp * 0.7 + 0.02, 0.0, out_) : 0.5 * exp(out_ * 60.0);
    col += pal(hueBase + 0.5 + s * 0.8, 0.8, 1.0) * aura * amp * 0.45 * ubuf.presence;

    // --- Kick shockwaves: a chromatic ring expanding from the center, one per kick ----------------
    // kickAt() in lock-ring/kicks.mjs: front and strength (blast).
    vec3 wakeCol = pal(hueBase + 0.3, 0.9, 1.0);
    for (int j = 0; j < KICKS; j++) {
        float age = kickAge(j);
        float power = kickPower(j);
        if (power <= 0.0 || age >= PLAYED_OUT)
            continue;
        float reach = KICK_ORIGIN + (MAX_REACH - KICK_ORIGIN) * power;
        float front = KICK_ORIGIN + (reach - KICK_ORIGIN) * (1.0 - exp(-age * KICK_GROW));
        float blast = power * exp(-age * KICK_FADE);
        float ds = r - front;                 // > 0 ahead of the front, < 0 behind it
        float eL = exp(-ds * ds / 0.0008);
        float eM = exp(-(ds + 0.035) * (ds + 0.035) / 0.0008);
        float eB = exp(-(ds + 0.07) * (ds + 0.07) / 0.0008);
        col += (pow(LAVENDER, vec3(1.6)) * eL + pow(MAUVE, vec3(2.0)) * eM * 0.85 + pow(BLUE, vec3(2.0)) * eB * 0.75)
               * blast * 1.4;
        float wake = ds < 0.0 && r > KICK_ORIGIN ? exp(ds * 5.0) : 0.0;
        col += wakeCol * wake * blast * 0.2;
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

    // The kick's punch, and the intensity, on everything but the hour points, as viz.frag's.
    col *= 1.0 + 0.4 * ubuf.kick;
    col *= ubuf.intensity;

    // --- Hour points, riding on the ribbon (hourPoints() in lock-ring/ring.mjs) -----------------
    // Clock marks, so at full brightness whatever the intensity. Each flashes as a shockwave's
    // front reaches its radius (shockwaveCrossing()), not at the kick's instant.
    for (int i = 0; i < 12; i++) {
        float th = float(i) * TAU / 12.0;
        float ai = abs(th - PI);
        float level = min(1.0, 1.3 * spectrum(pow(ai / PI, ubuf.bassStretch)));
        float ri = ribbonRadius(th, level, 0);
        vec2 at = ri * vec2(sin(th), -cos(th));
        float quarter = i - (i / 3) * 3 == 0 ? 1.0 : 0.0;
        float hit = shockwaveCrossing(ri);
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

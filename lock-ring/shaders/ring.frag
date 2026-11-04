#version 450
// Lock Ring: the Bar Visualizer's neon spectrum ribbons (shaders/viz.frag) bent into a circle around
// the dial. They bulge outward with each band's level, mirrored left and right with bass at the
// bottom, and the ring's radius swells with the music's energy. On every Kick a chromatic shockwave
// expands from the center hub, bigger on a harder hit, and a spray of sparks flies off the ring; up
// to KICKS of them play at once. On top, the clock's three hands as neon wave ribbons (hand()):
// they swing, thicken and glow with their bands and whip on every Kick, around a straight axis at
// the true time. In silence only the hands are drawn, as plain lines, over the faint dial
// LockRing.qml draws underneath.
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
    float swell;        // radius growth, as a fraction of the dial radius
    float presence;     // 0 = silent (draw nothing) .. 1 = full ribbons
    float dial;         // the dial's radius, as a fraction of half the item's size
    float intensity;
    float bassStretch;
    // The hands (lock-ring/hands.mjs handPoses()), x = hour, y = minute, z = second, w unused.
    // Angles in radians, clockwise from 12 o'clock; everything else in dial radii.
    float pixel;        // one pixel, in dial radii (for antialiasing)
    float handFlash;    // 0..1, how white-hot all hands flash on a kick (kicks.mjs handFlash())
    vec4 handAngle;     // where each hand points: from the time alone (clock.mjs)
    vec4 handLength;    // hub to tip
    vec4 handAmp;       // the wave's sideways reach (handLook().amplitude), 0 = straight
    vec4 handWidth;     // the ribbon's thickness
    vec4 handGlow;      // 0..1, the band's level as neon halo and extra strands
    vec4 kickAge0; vec4 kickAge1;      // the last KICKS kicks (any order), lock-ring/kicks.mjs kickSlots()
    vec4 kickPower0; vec4 kickPower1;  // 0 = empty slot
    vec4 kickSeed0; vec4 kickSeed1;
    vec4 b0; vec4 b1; vec4 b2; vec4 b3;
    vec4 b4; vec4 b5; vec4 b6; vec4 b7;
} ubuf;

const float PI = 3.14159265359;
const float TAU = 6.28318530718;
const int KICKS = 8;  // matches kickSlots in audio/AudioPipeline.qml and KICKS in lock-ring/kicks.mjs

// In dial radii, as in lock-ring/kicks.mjs: the hub, and how far the hardest hit reaches.
const float HUB = 0.014 / 0.34;
const float MAX_REACH = 0.9 * 0.5 / 0.34;

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

// --- Hands: neon wave ribbons ----------------------------------------------------------------
// Each hand is a ribbon of HAND_STRANDS strands, like viz.frag's, whose centrelines undulate
// sideways around the hand's straight hub-to-tip axis in a wave travelling from the hub to the tip.
// The axis is the true time (handAngle); the wave starts at nothing at the hub and leaves the tip
// by the axis (waveEnvelope()). In silence (handAmp 0, handGlow 0) the strands collapse into one
// plain line. Uses the uniforms handAngle, handLength, handAmp, handWidth, handGlow, handFlash,
// pixel, plus time, flow and treble.
//
// WAVE in lock-ring/hands.mjs; waveEnvelope() and waveOffset() mirror it.
const float WAVE_PERIODS = 1.5;
const float WAVE_RISE = 0.3;
const float WAVE_FALL = 0.35;
const float WAVE_TIP = 0.12;
const float WAVE_RIPPLE = 0.15;
const int HAND_STRANDS = 3;
const float HALO_END = 0.35;  // where a hand's halo has faded out, in dial radii from a strand

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
vec3 hand(vec2 q, float index, float angle, float len, float amp, float width, float glow, vec3 color) {
    vec2 dir = vec2(sin(angle), -cos(angle));  // hub to tip
    vec2 side = vec2(cos(angle), sin(angle));  // to the hand's right
    float along = dot(q, dir);
    float across = dot(q, side);
    // Cheap reject: past the hand's reach (its length, swing and halo, which ends at HALO_END).
    if (along < -HALO_END || along > len + HALO_END || abs(across) > amp + width + HALO_END)
        return vec3(0.0);
    float u = along / len;
    float uc = clamp(u, 0.0, 1.0);
    float flash = ubuf.handFlash;
    float tr = ubuf.treble;
    vec3 col = vec3(0.0);
    for (int k = 0; k < HAND_STRANDS; k++) {
        float fk = float(k);
        // Strands drift apart with the band: each its own speed, phase and reach. Multiples of
        // 1/20 on flow, and of TAU/1200 on time, keep the waves seamless where those wrap.
        float phase = ubuf.flow * (1.5 + 0.75 * fk) + ubuf.time * TAU * (0.5 + 0.15 * fk) + fk * 2.1 + index * 1.3;
        float a = amp * (1.0 - 0.22 * fk);
        float y = waveOffset(uc, phase, a, tr);
        float d;
        if (u > 0.0 && u < 1.0) {
            // Distance across the strand, corrected for its slope so steep stretches stay as thick.
            float e = 0.01;
            float slope = (waveOffset(uc + e, phase, a, tr) - waveOffset(uc - e, phase, a, tr)) / (2.0 * e * len);
            d = abs(across - y) / sqrt(1.0 + slope * slope);
        } else {
            d = length(vec2(along - uc * len, across - y));  // round caps at the hub and tip
        }
        // Slim neon, like viz.frag's ribbons: the main strand is the hand, a thin line with a
        // hairline white-hot core; the others are hairlines that come in with the band and the
        // kick. The impact is the swing and the glow around them, not their thickness.
        float main = k == 0 ? 1.0 : 0.0;
        float weight = mix(clamp(glow + flash, 0.0, 1.0) * (0.85 - 0.2 * fk), 1.0, main);
        float w = max(0.6 * ubuf.pixel, width * mix(0.2, 0.5, main));  // half thickness
        float body = smoothstep(w + ubuf.pixel, w - ubuf.pixel, d);
        float cw = max(0.5 * ubuf.pixel, w * 0.35);
        float hot = exp(-d * d / (cw * cw));                           // white-hot core
        float hw = 0.004 + 0.014 * glow + 0.02 * flash;                // halo half-width
        float halo = 1.0 / (1.0 + d * d / (hw * hw)) * smoothstep(HALO_END, HALO_END * 0.4, d);
        vec3 c = mix(color, pal(ubuf.time * 0.05 + index * 0.33 + fk * 0.2, 0.9, 1.0), 0.3 * fk);
        col += weight * (c * body * mix(0.8, 1.0, main)
                       + vec3(1.0) * hot * (0.3 + 0.7 * glow + 1.2 * flash)
                       + pow(c, vec3(2.2)) * halo * (0.12 + 0.7 * glow + 0.9 * flash));
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
    float amp = min(1.0, 1.3 * spectrum(s));
    float base = 1.0 + ubuf.swell;
    float t = ubuf.time;
    float hueBase = t * 0.05 + s * 0.15;

    vec3 col = vec3(0.0);

    // --- Neon spectrum ribbons ---------------------------------------------
    // Waves travel around the ring from the bottom up, advanced by audio energy (ubuf.flow) like the
    // bar's: loud = racing, quiet = crawling. They only reach outward from the swelling base.
    float glowW = 0.0025;
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float freq = 3.0 + fk * 2.0;
        float phase = ubuf.flow * (1.0 + fk * 0.5) + fk * 2.1;
        float wave = 0.5 + 0.5 * sin(a * freq - phase) + 0.15 * sin(a * freq * 2.3 - phase * 1.7) * ubuf.treble;
        float rr = base + 0.32 * amp * clamp(wave, 0.0, 1.2);
        float d = r - rr;
        float glow = glowW / (d * d * 6.0 + glowW) * (0.6 + 1.8 * amp);
        vec3 c = pal(hueBase + fk * 0.33 + s * 0.6 + amp * 0.2, 0.9, 1.0);
        col += c * glow * 0.4;
    }

    // --- Spectrum aura: a soft fill from the base outward ---------------------
    float out_ = r - base;
    float aura = out_ >= 0.0 ? smoothstep(0.32 * amp * 0.7 + 0.02, 0.0, out_) : exp(out_ * 30.0);
    col += pal(hueBase + 0.5 + s * 0.8, 0.8, 1.0) * aura * amp * 0.35;

    col *= ubuf.presence;

    // --- Kick shockwaves: a chromatic ring expanding from the hub, one per kick ----------------
    // kickAt() in lock-ring/kicks.mjs: front and strength.
    vec3 wakeCol = pal(hueBase + 0.3, 0.9, 1.0);
    for (int j = 0; j < KICKS; j++) {
        float age = kickAge(j);
        float power = kickPower(j);
        if (power <= 0.0 || age >= 3.0)
            continue;
        float reach = HUB + (MAX_REACH - HUB) * power;
        float front = HUB + (reach - HUB) * (1.0 - exp(-age * 4.5));
        float blast = power * exp(-age * 2.2);
        float ds = r - front;                 // > 0 ahead of the front, < 0 behind it
        float eL = exp(-ds * ds / 0.0012);
        float eM = exp(-(ds + 0.025) * (ds + 0.025) / 0.0012);
        float eB = exp(-(ds + 0.05) * (ds + 0.05) / 0.0012);
        col += (pow(LAVENDER, vec3(1.6)) * eL + pow(MAUVE, vec3(2.0)) * eM * 0.85 + pow(BLUE, vec3(2.0)) * eB * 0.75)
               * blast * 1.1;
        float wake = ds < 0.0 && r > HUB ? exp(ds * 6.0) : 0.0;
        col += wakeCol * wake * blast * 0.12;
    }

    // --- Kick sparks: a spray flung off the ring, streaking outward, one per kick ---------------
    // kickAt() in lock-ring/kicks.mjs: sparks (the spray's outer edge) and sparkLife.
    vec2 q = p / ubuf.dial;                  // in dial radii, y down
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

    col *= ubuf.intensity;

    // --- Hands, at full brightness whatever the intensity, so the clock always reads -----------
    // Second on top of minute on top of hour; light adds, as in the ribbons.
    col += hand(q, 0.0, ubuf.handAngle.x, ubuf.handLength.x, ubuf.handAmp.x, ubuf.handWidth.x, ubuf.handGlow.x, LAVENDER);
    col += hand(q, 1.0, ubuf.handAngle.y, ubuf.handLength.y, ubuf.handAmp.y, ubuf.handWidth.y, ubuf.handGlow.y, MAUVE);
    col += hand(q, 2.0, ubuf.handAngle.z, ubuf.handLength.z, ubuf.handAmp.z, ubuf.handWidth.z, ubuf.handGlow.z, PINK);

    col = col / (1.0 + col * 0.35);                   // soft tone-map, as in viz.frag

    // Emissive, premultiplied: alpha follows brightness. Fades out before the item's edge.
    float mask = smoothstep(1.0, 0.9, edge) * ubuf.qt_Opacity;
    float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    fragColor = vec4(col, alpha) * mask;
}

#version 450
// Lock Ring: the Bar Visualizer's neon spectrum ribbons (shaders/viz.frag) bent into a circle around
// the dial. They bulge outward with each band's level, mirrored left and right with bass at the
// bottom, and the ring's radius swells with the music's energy. On every Kick a chromatic shockwave
// expands from the center hub, bigger on a harder hit, and a spray of sparks flies off the ring; up
// to KICKS of them play at once. Draws nothing in silence (presence 0, no kicks), which leaves the
// faint dial LockRing.qml draws underneath.
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
const float HUB = 0.02 / 0.34;
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
    col = col / (1.0 + col * 0.35);                   // soft tone-map, as in viz.frag

    // Emissive, premultiplied: alpha follows brightness. Fades out before the item's edge.
    float mask = smoothstep(1.0, 0.9, edge) * ubuf.qt_Opacity;
    float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    fragColor = vec4(col, alpha) * mask;
}

#version 450
// Bar visualizer: hue-cycling plasma + spectrum-driven neon ribbons + kick flashes + treble sparks.
// Compile: /usr/lib/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 -o viz.frag.qsb viz.frag

layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;

layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float time;
    float bass;
    float mid;
    float treble;
    float kick;
    float radius;
    float intensity;
    float bassStretch;
    float flow;
    vec4 kickAge0; vec4 kickAge1;      // the last KICKS kicks (ring buffer, any order)
    vec4 kickPower0; vec4 kickPower1;  // 0 = empty slot
    vec4 kickSeed0; vec4 kickSeed1;
    vec2 res;
    vec4 b0; vec4 b1; vec4 b2; vec4 b3;
    vec4 b4; vec4 b5; vec4 b6; vec4 b7;
} ubuf;

const float TAU = 6.28318530718;
const int KICKS = 8;  // matches kickSlots in shell.qml

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

// Kick i's shockwave at s: x = distance from its front (> 0 ahead, < 0 behind), y = strength.
// The front eases out from the centre (fast burst, slowing at the edges).
vec2 shock(int i, float s) {
    float age = kickAge(i);
    return vec2(s - (1.0 - exp(-age * 4.5)), kickPower(i) * exp(-age * 2.2));
}

// Spectrum at s in [0,1] (0 = bass), linearly interpolated across 32 bands.
float spectrum(float s) {
    float f = clamp(s, 0.0, 1.0) * 31.0;
    int i = int(floor(f));
    return mix(band(i), band(min(i + 1, 31)), fract(f));
}

// Catppuccin Mocha, lavender-led: cycles lavender → mauve → lavender → pink → lavender → blue.
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

// h picks the palette position, s deepens the pastel (higher = richer, less white), v scales.
// Deepening matters because additive glow pushes pastels to white.
vec3 pal(float h, float s, float v) {
    return v * pow(palette(h), vec3(1.0 + 1.5 * s));
}

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float hash1(float n) {
    return fract(sin(n * 12.9898) * 43758.5453);
}

// Fold y back into [0,1] so particles bounce off the bar's top and bottom.
float bounce(float y) {
    return 1.0 - abs(1.0 - mod(y, 2.0));
}

float roundedBoxAlpha(vec2 px, vec2 size, float r) {
    vec2 q = abs(px - size * 0.5) - (size * 0.5 - vec2(r));
    float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
    return clamp(0.5 - d, 0.0, 1.0);
}

void main() {
    vec2 px = qt_TexCoord0 * ubuf.res;
    float h = ubuf.res.y;
    float k2 = ubuf.kick * ubuf.kick;
    vec2 shake = vec2(sin(ubuf.time * 97.0), cos(ubuf.time * 83.0)) * vec2(0.35, 0.12) * k2;
    vec2 p = vec2(px.x / h, qt_TexCoord0.y) + shake;  // x in bar-heights, y in [0,1]
    float cx = ubuf.res.x / h * 0.5;
    float s = abs(p.x - cx) / cx;                     // 0 at centre, 1 at edges
    float t = ubuf.time;
    // pow > 1 widens the low end so bass isn't hidden under the bar's centre widgets.
    // Ribbons surge as a shockwave front passes; overlapping kicks add up.
    float surge = 0.0;
    for (int j = 0; j < KICKS; j++) {
        vec2 sw = shock(j, s);
        surge += sw.y * exp(-sw.x * sw.x / 0.003);
    }
    float amp = min(1.0, 1.3 * spectrum(pow(s, ubuf.bassStretch)) * (1.0 + 0.7 * ubuf.kick) + 0.6 * surge);

    // --- Plasma haze: transparent at rest, flashes in on kicks --------------
    float n = sin(p.x * 0.31 + t * 0.9 + sin(p.y * 4.0 + t * 1.3) * 1.5)
            + sin(p.x * 0.11 - t * 0.6 + ubuf.bass * 2.0)
            + sin((p.x * 0.07 + p.y * 2.0) + t * 0.4);
    float hueBase = t * 0.05 + p.x * 0.004;
    vec3 col = pal(hueBase + n * 0.08, 0.85, (0.12 + 0.08 * (n * 0.5 + 0.5)) * k2);

    // --- Neon spectrum ribbons ---------------------------------------------
    // Waves travel outward from the centre, advanced by audio energy (ubuf.flow), not the clock:
    // loud = racing, quiet = crawling, silent = frozen.
    float glowW = 0.010 + 0.030 * ubuf.kick;
    float dx = abs(p.x - cx);
    for (int k = 0; k < 3; k++) {
        float fk = float(k);
        float freq = 2.6 + fk * 1.4;
        float phase = ubuf.flow * (1.0 + fk * 0.5) + fk * 2.1;
        float wave = sin(dx * freq - phase) + 0.3 * sin(dx * freq * 2.3 - phase * 1.7) * ubuf.treble;
        float y = 0.5 + 0.42 * amp * wave;
        float d = abs(p.y - y);
        float glow = glowW / (d * d * 18.0 + glowW) * (0.6 + 1.8 * amp);
        vec3 c = pal(hueBase + fk * 0.33 + s * 0.6 + amp * 0.2, 0.9, 1.0);
        col += c * glow * 0.55;
    }

    // --- Spectrum aura: soft vertical fill around the centre line -----------
    float aura = smoothstep(amp * 0.5 + 0.02, 0.0, abs(p.y - 0.5));
    col += pal(hueBase + 0.5 + s * 0.8, 0.8, 1.0) * aura * amp * 0.35;

    // --- Treble sparks -------------------------------------------------------
    vec2 cell = floor(vec2(p.x * 3.0, p.y * 3.0));
    float r = hash(cell + mod(floor(t * 12.0), 256.0));   // keep the sin() in hash() small
    vec2 f = fract(vec2(p.x * 3.0, p.y * 3.0)) - 0.5;
    float spark = step(0.97 - ubuf.treble * 0.15, r) * smoothstep(0.18, 0.0, length(f));
    col += pal(r + t * 0.2, 0.6, 1.0) * spark * (0.4 + 1.6 * ubuf.treble);

    // --- Kick shockwaves: chromatic blast front + glowing wake, one per kick ---
    float lens = 0.45 + 0.55 * smoothstep(0.6, 0.0, abs(p.y - 0.5));   // hottest along the centre line
    vec3 wakeCol = pal(hueBase + 0.3, 0.9, 1.0);
    for (int j = 0; j < KICKS; j++) {
        vec2 sw = shock(j, s);
        float ds = sw.x;
        float blast = sw.y;
        float eL = exp(-ds * ds / 0.0006);
        float eM = exp(-(ds + 0.018) * (ds + 0.018) / 0.0006);
        float eB = exp(-(ds + 0.036) * (ds + 0.036) / 0.0006);
        col += (pow(LAVENDER, vec3(1.6)) * eL + pow(MAUVE, vec3(2.0)) * eM * 0.85 + pow(BLUE, vec3(2.0)) * eB * 0.75)
               * blast * lens * 1.1;
        float wake = ds < 0.0 ? exp(ds * 7.0) : 0.0;
        col += wakeCol * wake * blast * lens * 0.18;
    }

    // --- Kick particles: sparks flung out of the centre, streaking and bouncing, one spray per kick ---
    for (int j = 0; j < KICKS; j++) {
        float age = kickAge(j);
        float power = kickPower(j);
        if (age >= 2.0 || power <= 0.0)
            continue;
        for (int i = 0; i < 24; i++) {
            float seed = kickSeed(j) * 31.7 + float(i) * 7.13;
            float r1 = hash1(seed);
            float r2 = hash1(seed + 1.7);
            float r3 = hash1(seed + 3.1);
            float r4 = hash1(seed + 5.9);
            float dir = r1 < 0.5 ? -1.0 : 1.0;
            float rate = (2.0 + 3.0 * r2) * (0.6 + 0.4 * power);
            float reach = cx * (0.25 + 0.75 * r3);              // how far it flies, in bar-heights
            float ease = exp(-age * rate);
            float travel = reach * (1.0 - ease);
            float speed = reach * rate * ease;                  // current speed, for the streak length
            vec2 pos = vec2(cx + dir * travel,
                            bounce(0.5 + (r4 - 0.5) * 0.5 + (r4 - 0.5) * 3.0 * (1.0 - exp(-age * 3.0))));

            float q = (p.x - pos.x) * dir;                       // > 0 ahead of the spark, < 0 on its trail
            float trail = clamp(speed * 0.025, 0.05, 2.5);
            float dy = p.y - pos.y;
            float d2 = q * q / (q > 0.0 ? 0.004 : trail * trail + 0.004) + dy * dy / 0.004;
            float life = power * exp(-age * (1.4 + 1.6 * r2));
            float twinkle = 0.75 + 0.25 * sin(age * 40.0 + r3 * 20.0);
            col += pal(r1 * 0.5 + r4 * 0.5 + hueBase, 0.8, 1.0) * exp(-d2) * life * twinkle * 1.2;
        }
    }
    col += mix(LAVENDER, vec3(1.0), 0.5) * k2 * k2 * 0.1 * smoothstep(1.0, 0.0, s);   // subtle centre punch
    col *= 1.0 + 0.4 * ubuf.kick;

    col *= ubuf.intensity;
    col = col / (1.0 + col * 0.35);                   // soft tone-map so peaks don't clip harshly

    // Emissive output: alpha follows brightness, so dark areas stay see-through (premultiplied).
    float mask = roundedBoxAlpha(px, ubuf.res, ubuf.radius) * ubuf.qt_Opacity;
    float a = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    fragColor = vec4(col, a) * mask;
}

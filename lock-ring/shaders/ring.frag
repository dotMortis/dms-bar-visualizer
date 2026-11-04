#version 450
// Lock Ring: the Bar Visualizer's neon spectrum ribbons (shaders/viz.frag) bent into a circle around
// the dial. They bulge outward with each band's level, mirrored left and right with bass at the
// bottom, and the ring's radius swells with the music's energy. Draws nothing in silence
// (presence 0), which leaves the faint dial LockRing.qml draws underneath.
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
    vec4 b0; vec4 b1; vec4 b2; vec4 b3;
    vec4 b4; vec4 b5; vec4 b6; vec4 b7;
} ubuf;

const float PI = 3.14159265359;

float band(int i) {
    int v = i / 4;
    int c = i - v * 4;
    vec4 q = v == 0 ? ubuf.b0 : v == 1 ? ubuf.b1 : v == 2 ? ubuf.b2 : v == 3 ? ubuf.b3
           : v == 4 ? ubuf.b4 : v == 5 ? ubuf.b5 : v == 6 ? ubuf.b6 : ubuf.b7;
    return q[c];
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

    col *= ubuf.presence * ubuf.intensity;
    col = col / (1.0 + col * 0.35);                   // soft tone-map, as in viz.frag

    // Emissive, premultiplied: alpha follows brightness. Fades out before the item's edge.
    float mask = smoothstep(1.0, 0.9, edge) * ubuf.qt_Opacity;
    float alpha = clamp(max(col.r, max(col.g, col.b)), 0.0, 1.0);
    fragColor = vec4(col, alpha) * mask;
}

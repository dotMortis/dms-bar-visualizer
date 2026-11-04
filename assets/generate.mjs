#!/usr/bin/env node
// Generates the animated SVGs in assets/: the README's hero (both visualizers on one beat), the
// labeled Bar Visualizer and Lock Ring animations, and the layer diagram. SVG animation (SMIL),
// so they move on GitHub without a video. Run: node assets/generate.mjs
//
// The music is synthetic: a 6 s loop at 120 bpm that builds from quiet to a drop and back. The Bar
// Visualizer is re-created from shaders/viz.frag. The Lock Ring is drawn from the plugin's own
// modules (docs/lock-ring/*.mjs), so its Ribbons, Shockwaves, Hour Points, Hands and Digital Time
// move as on the lock screen; only the glow is approximated, with SVG filters.
import { writeFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DIAL_RATIO, spectrumAt, spectrumLevel, ribbonRadius, hourPoints, createRingMotion, IDLE, RIBBON } from "../docs/lock-ring/ring.mjs";
import { shockwaveFront, shockwaveCrossing, ribbonSurge, centerPunch, auraPush, handFlash, shapeChaos, kickSlots, MAX_REACH, AURA_PUSH, KICK_ORIGIN } from "../docs/lock-ring/kicks.mjs";
import { TIME_FONT, TIME_TOP, TIME_RADIUS, TIME_HIT, timeHit } from "../docs/lock-ring/clock.mjs";
import { handPoses, createHandMotion, waveOffset, HANDS } from "../docs/lock-ring/hands.mjs";
import { DEFAULTS } from "../docs/config.mjs";

const OUT = dirname(fileURLToPath(import.meta.url));
const TAU = 2 * Math.PI;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smoothstep = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const lerp = (a, b, w) => a + (b - a) * w;

// --- Catppuccin Mocha, as palette() in viz.frag and ring.frag -----------------------------------
const LAVENDER = [0.706, 0.745, 0.996];
const MAUVE = [0.796, 0.651, 0.969];
const PINK = [0.961, 0.761, 0.906];
const BLUE = [0.537, 0.706, 0.980];
const CYCLE = [LAVENDER, MAUVE, LAVENDER, PINK, LAVENDER, BLUE, LAVENDER];

function palette(h) {
    const f = (((h % 1) + 1) % 1) * 6;
    const i = Math.floor(f), m = smoothstep(0, 1, f - i);
    return CYCLE[i].map((a, j) => a + (CYCLE[i + 1][j] - a) * m);
}
const pal = (h, s, v = 1) => palette(h).map(c => v * c ** (1 + 1.5 * s));
const deepen = (c, p) => c.map(x => x ** p);
const hex = (c, boost = 1) => "#" + c.map(x => Math.round(255 * clamp(x * boost)).toString(16).padStart(2, "0")).join("");
const n1 = x => (Math.round(x * 10) / 10).toString();
const n2 = x => (Math.round(x * 100) / 100).toString();
const n3 = x => (Math.round(x * 1000) / 1000).toString();

// --- The synthetic music --------------------------------------------------------------------------
// 6 s at 120 bpm: quiet (one soft Kick), a build that speeds up to a double Kick, a breath, the
// drop on a full-power Kick, and a tail that eases back into the quiet, so the loop is seamless.
const LOOP = 6;
const FPS = 15;
const FRAMES = LOOP * FPS;
const SIM_RATE = 60;                 // the simulation's steps per second, sampled every SIM_RATE / FPS
const KICKS = [                      // [time, power]
    [0.5, 0.55],
    [1.0, 0.56], [1.5, 0.58], [2.0, 0.62], [2.25, 0.58], [2.5, 0.66], [2.75, 0.64], [3.0, 0.74], [3.125, 0.72],
    [3.5, 1.0],
    [4.0, 0.9], [4.5, 0.8], [5.0, 0.64],
];
const DROP = 3.5;
const KICK_DECAY = DEFAULTS.kickDecay;
const BASS_STRETCH = DEFAULTS.bassStretch;
const BANDS = 32;

// The loop's energy: quiet, building, a breath before the drop, the drop, the tail.
function energy(t) {
    const u = ((t % LOOP) + LOOP) % LOOP;
    if (u < 1) return 0.15;
    if (u < 3.15) return lerp(0.15, 0.5, smoothstep(1, 3.15, u));
    if (u < DROP) return lerp(0.5, 0.06, smoothstep(3.15, 3.3, u));
    if (u < 5) return lerp(1, 0.72, smoothstep(DROP, 5, u));
    return lerp(0.72, 0.15, smoothstep(5, 5.9, u));
}

// Every Kick of the endless loop up to time t, newest first: { time, power, seed }.
function kicksBefore(t) {
    const out = [];
    for (let loop = Math.floor(t / LOOP); loop >= Math.floor(t / LOOP) - 1; loop--)
        KICKS.forEach(([kt, power], i) => {
            const time = loop * LOOP + kt;
            if (time <= t + 1e-9) out.push({ time, power, seed: (loop + 10) * KICKS.length + i + 1 });
        });
    return out.sort((a, b) => b.time - a.time);
}

// The pipeline's 8 slots at t: the last 8 Kicks' ages, powers and seeds.
function slotsAt(t) {
    const last = kicksBefore(t).slice(0, 8);
    return { ages: last.map(k => t - k.time), powers: last.map(k => k.power), seeds: last.map(k => k.seed) };
}

// The last Kick's impact, fading at kickDecay (the shaders' `kick`).
function kickEnv(t) {
    let k = 0;
    for (const { time, power } of kicksBefore(t)) k = Math.max(k, power * Math.exp(-(t - time) * KICK_DECAY));
    return k;
}

const treble = t => clamp(0.25 + 0.55 * energy(t) + 0.15 * Math.sin(TAU * t * 4 / 3) * Math.sin(TAU * t / 2));

// cava's 32 bands at t, bass first.
function bands(t) {
    const k = kickEnv(t), e = energy(t), tr = treble(t);
    const values = [];
    for (let i = 0; i < BANDS; i++) {
        const s = i / (BANDS - 1);
        const bass = Math.exp(-s * 6) * (0.25 * e + 0.75 * k);
        const mids = 0.45 * e * (0.5 + 0.5 * Math.sin(s * 13 - TAU * t / 1.5)) * Math.exp(-s * 1.4);
        const highs = 0.22 * tr * (0.5 + 0.5 * Math.sin(s * 29 + TAU * t * 2)) * smoothstep(0.3, 0.8, s);
        values.push(clamp(0.03 + bass + mids + highs));
    }
    return values;
}
const mean = (v, a, b) => v.slice(a, b).reduce((x, y) => x + y, 0) / (b - a);

// --- The simulation -------------------------------------------------------------------------------
// Runs the music from two loops back, so every follower has settled, and keeps one state per frame
// for the loop before this one and this one: state(i) for frame i, state(i - FRAMES) one loop earlier.
// The flow and the hands' phases only grow, so the loop's last second crossfades every shape toward
// the one a loop earlier, which ends where the first frame begins.
const states = new Map();
{
    const ring = createRingMotion(), hands = createHandMotion();
    let flow = 0;
    const dt = 1 / SIM_RATE, every = SIM_RATE / FPS;
    for (let step = -2 * LOOP * SIM_RATE; step < LOOP * SIM_RATE; step++) {
        const t = step / SIM_RATE;
        const values = bands(t);
        const raw = { bass: mean(values, 0, 6), mid: mean(values, 6, 18), treble: mean(values, 18, 32) };
        const kick = kickEnv(t);
        flow += dt * (8 * raw.bass + 4 * raw.mid + 6 * kick);
        const motion = ring.step(raw, dt);
        const hand = hands.step(raw, dt, 1);
        if (step % every === 0 && step >= -LOOP * SIM_RATE)
            states.set(step / every, { t, values, ...raw, treble: treble(t), kick, flow, ...motion, ...hand, slots: slotsAt(t) });
    }
}
// The shapes at frame i, as fn(state) gives them: numbers or arrays of numbers, crossfaded over the
// loop's last second toward one loop earlier.
const BLEND = 1;
function shaped(i, fn) {
    const now = fn(states.get(i));
    const w = smoothstep(LOOP - BLEND, LOOP, i / FPS);
    if (w === 0) return now;
    const before = fn(states.get(i - FRAMES));
    const mix = (a, b) => Array.isArray(a) ? a.map((x, j) => mix(x, b[j])) : typeof a === "number" ? lerp(a, b, w) : a;
    return mix(now, before);
}
const frameTimes = Array.from({ length: FRAMES + 1 }, (_, i) => i / FPS);

// --- SVG helpers ----------------------------------------------------------------------------------
// An attribute animated through one value per frame (FRAMES + 1, the last equal to the first).
function anim(attr, values, extra = "") {
    return `<animate attributeName="${attr}" dur="${LOOP}s" repeatCount="indefinite" values="${values.join(";")}"${extra}/>`;
}
// One value per frame for frames 0..FRAMES, frame FRAMES being frame 0 again.
const perFrame = fn => frameTimes.map((_, i) => fn(i % FRAMES));
// A polyline in relative moves, at `scale` units per pixel (so integers stay precise).
function relPath(points, close = false, scale = 2) {
    let out = "", px = 0, py = 0;
    points.forEach(([x, y], j) => {
        const ix = Math.round(x * scale), iy = Math.round(y * scale);
        out += j === 0 ? `M${ix} ${iy}` : `${j === 1 ? "l" : " "}${ix - px} ${iy - py}`;
        px = ix; py = iy;
    });
    return close ? out + "z" : out;
}
// An element's attributes for something that only lives for a moment, from `from` to `to` seconds
// into the loop (past its end it carries on at its start): sampled while live, held still and
// invisible otherwise, so the file holds only the live frames. sample(t, live) gives one value per
// attribute. `samples` samples the live stretch that many times, crowded toward its start (for
// things that move fast at first and ease out); otherwise once per frame.
function liveAnim(attrs, from, to, sample, samples = 0) {
    const wrap = t => t >= LOOP ? t - LOOP : t;
    const live = t => to > LOOP ? t >= from || t <= to - LOOP : t >= from && t <= to;
    const span = to - from, eps = 0.002;
    let inside = samples
        ? Array.from({ length: samples }, (_, j) => from + span * (j / (samples - 1)) ** 1.6)
        : Array.from({ length: Math.floor(span * FPS) + 1 }, (_, j) => Math.ceil(from * FPS) / FPS + j / FPS).filter(t => t <= to);
    const times = new Set([0, LOOP, ...inside.map(wrap)]);
    if (from > eps) times.add(from - eps);
    if (wrap(to) + eps < LOOP) times.add(wrap(to) + eps);
    const sorted = [...times].sort((x, y) => x - y);
    const keyTimes = sorted.map(t => (Math.round(t / LOOP * 1e4) / 1e4).toString()).join(";");
    const rows = sorted.map(t => sample(wrap(t), live(wrap(t))));
    return attrs.map((attr, j) =>
        `<animate attributeName="${attr}" dur="${LOOP}s" repeatCount="indefinite" keyTimes="${keyTimes}" values="${rows.map(r => r[j]).join(";")}"/>`).join("");
}
// How long ago Kick k fired at t, wrapping around the loop.
const ageOf = (t, k) => (((t - k.time) % LOOP) + LOOP) % LOOP;
// Hue-cycling colors on their own slow loop, as the shaders' time * 0.05.
const HUE_LOOP = 24;
function hueAnim(attr, offset, steps = 36, s = 0.9, boost = 1.15) {
    const vals = Array.from({ length: steps + 1 }, (_, i) => hex(pal(i / steps + offset, s), boost));
    return `<animate attributeName="${attr}" dur="${HUE_LOOP}s" repeatCount="indefinite" values="${vals.join(";")}"/>`;
}
const FONT = `font-family="Inter, 'Segoe UI', Roboto, Ubuntu, sans-serif"`;

// A frame's state for the live parts, which need no crossfade: everything Kick-driven repeats.
const at = t => states.get(Math.round(t * FPS) % FRAMES) ?? states.get(0);
const kickOfLoop = KICKS.map(([time, power], i) => ({ time, power, seed: 10 * KICKS.length + i + 1 }));

// --- Bar Visualizer (shaders/viz.frag) ----------------------------------------------------------
// The bar as a group at (x, y), w × h; the shared frame ids are prefixed with `id`.
function barPanel({ x, y, w, h, radius = 18, id = "bar", widgets = true }) {
    const cx = w / h / 2;                 // half the bar's width, in bar-heights
    const N = 110;
    // Where each Kick's Shockwave is at s (0 = center, 1 = the ends) and how bright: viz.frag shock().
    const shocks = st => kicksBefore(st.t).filter(k => st.t - k.time < 3).map(k => {
        const age = st.t - k.time;
        return { front: 1 - Math.exp(-age * 4.5), blast: k.power * Math.exp(-age * 2.2) };
    });
    function amp(st, s, sh) {
        let surge = 0;
        for (const { front, blast } of sh) surge += blast * Math.exp(-((s - front) ** 2) / 0.003);
        return Math.min(1, 1.3 * spectrumLevel(st.values, s ** BASS_STRETCH) * (1 + 0.7 * st.kick) + 0.6 * surge);
    }
    const ribbon = k => st => {
        const sh = shocks(st), freq = 2.6 + 1.4 * k, phase = st.flow * (1 + 0.5 * k) + 2.1 * k;
        const pts = [];
        for (let i = 0; i <= N; i++) {
            const px = w * i / N, dx = Math.abs(px / h - cx), a = amp(st, dx / cx, sh);
            const wave = Math.sin(dx * freq - phase) + 0.3 * Math.sin(dx * freq * 2.3 - phase * 1.7) * st.treble;
            pts.push([px, h * (0.5 + 0.42 * a * wave)]);
        }
        return pts;
    };
    const aura = st => {
        const sh = shocks(st), top = [], bot = [], n = 40;
        for (let i = 0; i <= n; i++) {
            const px = w * i / n, half = (amp(st, Math.abs(px / h - cx) / cx, sh) * 0.5 + 0.02) * h;
            top.push([px, h / 2 - half]); bot.push([px, h / 2 + half]);
        }
        return [...top, ...bot.reverse()];
    };
    const ribbons = [0, 1, 2].map(k => `<path fill="none" stroke="url(#${id}rib${k})" stroke-width="${2.6 - 0.4 * k}" stroke-linejoin="round" transform="scale(0.5)">`
        + anim("d", perFrame(i => relPath(shaped(i, ribbon(k))))) + `</path>`).join("");
    const auraSvg = `<path fill="url(#${id}aura)" opacity="0.4" transform="scale(0.5)">${anim("d", perFrame(i => relPath(shaped(i, aura), true)))}</path>`;

    // The Shockwaves: per Kick, three glowing chromatic bars per side (lavender leading, mauve and
    // blue trailing), and the wake behind them.
    const lens = 1;
    let shockSvg = "";
    for (const k of kickOfLoop) {
        for (const side of [-1, 1]) {
            for (const [lag, col, gain] of [[0, LAVENDER, 1], [0.018, MAUVE, 0.85], [0.036, BLUE, 0.75]]) {
                shockSvg += `<rect y="0" width="7" height="${h}" rx="3.5" fill="${hex(deepen(col, 1.6), 1.2)}" opacity="0">`
                    + liveAnim(["x", "opacity"], k.time, k.time + 1.4, (t, live) => {
                        const age = ageOf(t, k);
                        const front = Math.max(0, 1 - Math.exp(-age * 4.5) - lag);
                        // Faded out as it reaches the bar's ends, where the fronts would pile up.
                        const fade = 1 - smoothstep(0.8, 0.97, front);
                        return [n1(w / 2 + side * front * w / 2 - 3.5), live ? n2(clamp(k.power * Math.exp(-age * 2.2) * gain * fade * 1.2)) : 0];
                    }, 14) + `</rect>`;
            }
        }
        // The wake: a soft glow filling in behind both fronts.
        shockSvg += `<rect y="0" height="${h}" fill="url(#${id}wake)" opacity="0">`
            + liveAnim(["x", "width", "opacity"], k.time, k.time + 1.4, (t, live) => {
                const age = ageOf(t, k), front = 1 - Math.exp(-age * 4.5);
                return [n1(w / 2 - front * w / 2), n1(Math.max(1, front * w)), live ? n2(clamp(k.power * Math.exp(-age * 2.2) * 0.55 * (1 - smoothstep(0.8, 0.97, front)))) : 0];
            }, 14) + `</rect>`;
    }

    // The Spray: sparks flung out of the center on every Kick, streaking and bouncing.
    const bounce = v => 1 - Math.abs(1 - (((v % 2) + 2) % 2));
    let spray = "";
    let rng = mulberry(11);
    for (const k of kickOfLoop) {
        const count = Math.round(4 + 10 * (k.power - 0.5));
        for (let j = 0; j < count; j++) {
            const r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng();
            const dir = r1 < 0.5 ? -1 : 1, rate = (2 + 3 * r2) * (0.6 + 0.4 * k.power), reach = cx * (0.25 + 0.75 * r3);
            const col = hex(pal(r1 * 0.5 + r4 * 0.5, 0.8), 1.2);
            spray += `<path stroke="${col}" stroke-width="${n1(2 + 1.8 * r3)}" stroke-linecap="round" opacity="0">`
                + liveAnim(["d", "opacity"], k.time, k.time + 1.4, (t, live) => {
                    const age = live ? ageOf(t, k) : 0, ease = Math.exp(-age * rate);
                    const px = w / 2 + dir * reach * (1 - ease) * h;
                    const py = h * bounce(0.5 + (r4 - 0.5) * 0.5 + (r4 - 0.5) * 3 * (1 - Math.exp(-age * 3)));
                    const trail = clamp(reach * rate * ease * 0.025, 0.05, 2.5) * h;
                    const life = live ? k.power * Math.exp(-age * (1.4 + 1.6 * r2)) : 0;
                    return [`M${Math.round(px)} ${Math.round(py)}H${Math.round(px - dir * trail)}`, n2(clamp(life * 1.4))];
                }, 10) + `</path>`;
        }
    }

    // The Treble Sparks: twinkles on a grid, more and brighter with the treble.
    rng = mulberry(5);
    let sparks = "";
    for (let j = 0; j < 30; j++) {
        const sx = 8 + rng() * (w - 16), sy = 8 + rng() * (h - 16), phase = rng(), threshold = rng();
        const col = hex(pal(rng(), 0.6), 1.25);
        sparks += `<circle cx="${n1(sx)}" cy="${n1(sy)}" r="${n1(1.3 + rng() * 1.5)}" fill="${col}" opacity="0">`
            + anim("opacity", perFrame(i => {
                const st = at(i / FPS), on = Math.sin(TAU * (i / FPS * 1.5 + phase)) > 0.86 && threshold < 0.3 + 0.7 * st.treble;
                return on ? n2(0.5 + 0.5 * st.treble) : 0;
            }), ` calcMode="discrete"`) + `</circle>`;
    }

    // The Haze: transparent at rest, flashing in with the Kick's square. The Center Punch on top.
    const haze = `<rect width="${w}" height="${h}" fill="url(#${id}haze)" opacity="0">${anim("opacity", perFrame(i => n3(clamp(at(i / FPS).kick ** 2 * 0.8))))}</rect>`;
    const punch = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w * 0.22}" ry="${h * 0.9}" fill="url(#${id}punch)" opacity="0">${anim("opacity", perFrame(i => n3(clamp(at(i / FPS).kick ** 4 * 1.2))))}</ellipse>`;
    // The bar shakes on hard Kicks, as viz.frag's.
    const shake = `<animateTransform attributeName="transform" type="translate" dur="${LOOP}s" repeatCount="indefinite" values="${perFrame(i => {
        const st = at(i / FPS), k2 = st.kick ** 2;
        return `${n1(Math.sin(st.t * 97) * 0.35 * k2 * h * 0.35)} ${n1(Math.cos(st.t * 83) * 0.12 * k2 * h * 0.25)}`;
    }).join(";")}"/>`;

    const ribGrad = k => {
        const stops = [];
        for (let j = 0; j <= 8; j++) {
            const off = j / 8, s = Math.abs(off - 0.5) * 2;
            stops.push(`<stop offset="${n3(off)}">${hueAnim("stop-color", k * 0.33 + s * 0.6)}</stop>`);
        }
        return `<linearGradient id="${id}rib${k}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${2 * w}" y2="0">${stops.join("")}</linearGradient>`;
    };
    const defs = `${[0, 1, 2].map(ribGrad).join("")}
  <linearGradient id="${id}aura" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${2 * w}" y2="0">
    <stop offset="0" stop-color="#89b4fa"/><stop offset="0.3" stop-color="#cba6f7"/><stop offset="0.5" stop-color="#b4befe"/><stop offset="0.7" stop-color="#cba6f7"/><stop offset="1" stop-color="#89b4fa"/>
  </linearGradient>
  <radialGradient id="${id}haze" cx="0.5" cy="0.5" r="0.6"><stop offset="0" stop-color="#cba6f7" stop-opacity="0.9"/><stop offset="0.5" stop-color="#b4befe" stop-opacity="0.35"/><stop offset="1" stop-color="#89b4fa" stop-opacity="0"/></radialGradient>
  <radialGradient id="${id}punch"><stop offset="0" stop-color="#ffffff"/><stop offset="0.35" stop-color="#d9deff" stop-opacity="0.6"/><stop offset="1" stop-color="#b4befe" stop-opacity="0"/></radialGradient>
  <linearGradient id="${id}wake"><stop offset="0" stop-color="#cba6f7" stop-opacity="0.5"/><stop offset="0.5" stop-color="#b4befe" stop-opacity="0.05"/><stop offset="1" stop-color="#cba6f7" stop-opacity="0.5"/></linearGradient>
  <clipPath id="${id}clip"><rect width="${w}" height="${h}" rx="${radius}"/></clipPath>`;
    const body = `<g transform="translate(${x} ${y})">
  <g clip-path="url(#${id}clip)">
    <rect width="${w}" height="${h}" fill="#11111b" opacity="0.4"/>
    <g>${shake}
      ${haze}
      <g filter="url(#soft)">${auraSvg}</g>
      <g filter="url(#glow)">${ribbons}</g>
      <g filter="url(#glow)">${shockSvg}</g>
      <g filter="url(#glow)">${spray}${sparks}</g>
      ${punch}
    </g>
  </g>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="${radius}" fill="none" stroke="#cdd6f4" stroke-opacity="0.08"/>
  ${widgets ? barWidgets(w, h) : ""}
</g>`;
    return { defs, body };
}

// A stand-in for the transparent DankBar drawn over the Bar Visualizer.
function barWidgets(w, h) {
    const text = "#cdd6f4", sub = "#a6adc8", cy = h / 2, pill = `fill="#11111b" fill-opacity="0.55"`;
    const out = [];
    out.push(`<circle cx="34" cy="${cy}" r="13" ${pill}/><path d="M28 ${cy - 4}h12M28 ${cy}h12M28 ${cy + 4}h12" stroke="${text}" stroke-width="2" stroke-linecap="round"/>`);
    out.push(`<rect x="58" y="${cy - 13}" width="120" height="26" rx="13" ${pill}/><rect x="66" y="${cy - 5}" width="34" height="10" rx="5" fill="#b4befe"/>`);
    for (const px of [108, 126, 144, 162]) out.push(`<circle cx="${px}" cy="${cy}" r="5" fill="${sub}" fill-opacity="0.7"/>`);
    out.push(`<rect x="${w / 2 - 150}" y="${cy - 15}" width="300" height="30" rx="15" ${pill}/>`);
    out.push(`<text x="${w / 2 - 132}" y="${cy + 5}" fill="${text}" font-size="14" font-weight="700">10:08</text>`);
    out.push(`<circle cx="${w / 2 - 78}" cy="${cy}" r="2" fill="${sub}"/><text x="${w / 2 - 64}" y="${cy + 5}" fill="${sub}" font-size="13">&#9834; Now playing</text>`);
    for (let i = 0; i < 4; i++)
        out.push(`<rect x="${w / 2 + 98 + i * 6}" y="${cy - 6}" width="3" height="12" rx="1.5" fill="#cba6f7">`
            + anim("height", perFrame(j => n1(3 + 10 * clamp(at(j / FPS).values[i * 6] * 1.4)))) + anim("y", perFrame(j => n1(cy - (3 + 10 * clamp(at(j / FPS).values[i * 6] * 1.4)) / 2))) + `</rect>`);
    out.push(`<rect x="${w - 186}" y="${cy - 13}" width="128" height="26" rx="13" ${pill}/>`);
    for (const px of [-166, -142, -118, -94, -70]) out.push(`<circle cx="${w + px + 6}" cy="${cy}" r="5.5" fill="none" stroke="${sub}" stroke-width="1.8"/>`);
    out.push(`<circle cx="${w - 34}" cy="${cy}" r="13" ${pill}/><path d="M${w - 34} ${cy - 6}v5" stroke="${text}" stroke-width="2" stroke-linecap="round"/><path d="M${w - 38.5} ${cy - 3.5}a6 6 0 1 0 9 0" fill="none" stroke="${text}" stroke-width="2" stroke-linecap="round"/>`);
    return out.join("");
}

// A small seeded random number generator, so every run draws the same sparks.
function mulberry(seed) {
    return () => {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// --- Lock Ring (docs/lock-ring) -------------------------------------------------------------------
// The ring widget, `side` px square, centered at (cx, cy). The clock reads 10:08.
const CLOCK = new Date(2026, 10, 4, 10, 8, 24);
function ringPanel({ cx, cy, side, id = "ring" }) {
    const R = DIAL_RATIO * side;          // one dial radius, in px
    const N = 84;
    const polar = (r, theta) => [r * R * Math.sin(theta), -r * R * Math.cos(theta)];
    const surgeOf = st => (radius, angle) => ribbonSurge(radius, st.slots.ages, st.slots.powers, st.slots.seeds, angle);
    // A strand's shape: ring.frag's main loop, through ring.mjs and kicks.mjs.
    const strand = k => st => {
        const surge = surgeOf(st), pts = [];
        for (let i = 0; i < N; i++) {
            const angle = 360 * i / N, theta = angle * TAU / 360;
            const music = 1.3 * spectrumLevel(st.values, spectrumAt(angle, BASS_STRETCH)) * (1 + 0.7 * st.kick);
            const opts = { flow: st.flow, time: st.t, treble: st.treble, swell: st.swell, strand: k };
            const calm = ribbonRadius(angle, { ...opts, level: Math.min(1, music) });
            const level = Math.min(1, music + surge(calm, theta));
            pts.push(polar(ribbonRadius(angle, { ...opts, level }), theta));
        }
        return pts;
    };
    // The Aura: a band both ways from the calm spine, as wide as the strands swing there.
    const aura = st => {
        const outer = [], inner = [], n = 72;
        const push = AURA_PUSH * auraPush(st.slots.ages, st.slots.powers);
        for (let i = 0; i < n; i++) {
            const angle = 360 * i / n, theta = angle * TAU / 360;
            const amp = Math.min(1, 1.3 * spectrumLevel(st.values, spectrumAt(angle, BASS_STRETCH)));
            const spine = ribbonRadius(angle, { flow: st.flow, time: st.t, treble: st.treble, swell: st.swell }) + push;
            const reach = RIBBON.reach * (1 + RIBBON.ripple * st.treble) * amp * 0.7 + 0.02;
            outer.push(polar(spine + reach, theta));
            inner.push(polar(Math.max(0.5, spine - reach), theta));
        }
        return [outer, inner];
    };
    const strands = [0, 1, 2].map(k => `<path fill="none" stroke="url(#${id}rib${k})" stroke-width="${2.6 - 0.4 * k}" stroke-linejoin="round" transform="scale(0.5)">`
        + anim("d", perFrame(i => relPath(shaped(i, strand(k)), true))) + `</path>`).join("");
    const presence = perFrame(i => n2(lerp(IDLE.glow, 1, shaped(i, st => st.presence))));
    const auraSvg = `<path fill="url(#${id}aura)" fill-rule="evenodd" transform="scale(0.5)">`
        + anim("d", perFrame(i => { const [o, n] = shaped(i, aura); return relPath(o, true) + relPath(n, true); }))
        + anim("opacity", perFrame(i => n2(0.3 * shaped(i, st => st.presence)))) + `</path>`;

    // The Shockwaves: per Kick, its ragged front (shockwaveFront()) as a path, drawn as a wake fill,
    // a wide lavender front, and mauve and blue copies trailing it, plus Beads riding it.
    const SHOCK_N = 56;
    let shockDefs = "", shockSvg = "", beadSvg = "";
    for (const [j, k] of kickOfLoop.entries()) {
        const chaos = shapeChaos(k.power);
        const life = 0.5 + 1.3 * k.power;
        const end = k.time + life;
        const front = age => {
            const pts = [];
            for (let i = 0; i < SHOCK_N; i++) {
                const theta = TAU * i / SHOCK_N;
                pts.push(polar(shockwaveFront(age, k.power, k.seed, theta).front, theta));
            }
            return pts;
        };
        const strength = age => shockwaveFront(age, k.power, k.seed).strength;
        const pathId = `${id}k${j}`;
        const sample = (t, live) => {
            const age = live ? ageOf(t, k) : 0;
            return [relPath(front(age), true, 1), live ? n2(clamp(strength(age) * 1.3)) : 0];
        };
        const liveKick = (attrs, fn) => liveAnim(attrs, k.time, end, fn, 20);
        shockDefs += `<path id="${pathId}">${liveKick(["d"], (t, l) => [sample(t, l)[0]])}</path>`;
        // Brighter on one side, as shockwaveFront()'s SHAPE_LIGHT: a gradient across the front.
        const lit = TAU * ((k.seed * 0.819173) % 1);
        const gx = Math.sin(lit), gy = -Math.cos(lit);
        shockDefs += `<linearGradient id="${pathId}g" x1="${n2(0.5 - gx / 2)}" y1="${n2(0.5 - gy / 2)}" x2="${n2(0.5 + gx / 2)}" y2="${n2(0.5 + gy / 2)}">`
            + `<stop offset="0" stop-color="${hex(deepen(LAVENDER, 1.8), 0.85)}"/><stop offset="1" stop-color="${hex(deepen(LAVENDER, 1.2), 1.05)}"/></linearGradient>`;
        const opOnly = liveKick(["opacity"], (t, l) => [sample(t, l)[1]]);
        const scaleTo = lag => liveKick(["transform"], (t, live) => {
            const age = live ? ageOf(t, k) : 0;
            const f = shockwaveFront(age, k.power, k.seed).front;
            return [`${n3(Math.max(0, f - lag) / Math.max(f, 1e-3))}`];
        }).replace(/<animate attributeName="transform"/, `<animateTransform attributeName="transform" type="scale"`);
        shockSvg += `<g opacity="0">${opOnly}`
            + `<use href="#${pathId}" fill="url(#${id}wake)" stroke="none" opacity="0.22"/>`
            + `<use href="#${pathId}" fill="none" stroke="${hex(deepen(BLUE, 2), 1.3)}" stroke-width="${n1(7 + 3 * chaos)}" opacity="0.75">${scaleTo(0.1)}</use>`
            + `<use href="#${pathId}" fill="none" stroke="${hex(deepen(MAUVE, 2), 1.3)}" stroke-width="${n1(7 + 3 * chaos)}" opacity="0.85">${scaleTo(0.05)}</use>`
            + `<use href="#${pathId}" fill="none" stroke="url(#${pathId}g)" stroke-width="${n1(6 + 3 * chaos)}"/>`
            + `</g>`;

        // Beads: three rows of dots riding the front, lavender on it and mauve and blue trailing.
        if (k.power >= 0.85) {
            const rng = mulberry(k.seed * 7);
            for (let row = 0; row < 3; row++) {
                const count = Math.floor((16 + 14 * chaos) * (1 - 0.25 * row));
                const beads = Array.from({ length: count }, (_, i) => ({ th: (i + 0.5 + 0.8 * (rng() - 0.5)) / count * TAU + TAU * ((k.seed * 0.302776) % 1) + row * 0.37, jitter: rng() - 0.5, big: rng() > 0.6 }));
                const tint = hex(deepen([LAVENDER, MAUVE, BLUE][row], row ? 2 : 1.6), 1.35);
                for (const big of [false, true]) {
                    const mine = beads.filter(b => b.big === big);
                    if (!mine.length) continue;
                    const d = (t, live) => {
                        const age = live ? ageOf(t, k) : 0;
                        return [mine.map(b => {
                            const f = shockwaveFront(age, k.power, k.seed, b.th).front * (1 + b.jitter * 0.05 * (0.5 + chaos)) - 0.05 * row;
                            const [bx, by] = polar(Math.max(0, f), b.th);
                            return `M${Math.round(bx)} ${Math.round(by)}h0`;
                        }).join(""), live ? n2(clamp(strength(age) * 1.6 * (1 - 0.15 * row))) : 0];
                    };
                    beadSvg += `<path fill="none" stroke="${tint}" stroke-linecap="round" stroke-width="${n1((big ? 4.6 : 2.6) * (0.75 + 0.5 * chaos) * side / 400)}" opacity="0">${liveKick(["d", "opacity"], d)}</path>`;
                }
            }
        }
    }

    // The Spray: sparks flung off the ring on every Kick, streaking outward (ring.frag's own).
    let spray = "";
    const rng = mulberry(23);
    for (const k of kickOfLoop) {
        const count = Math.round(5 + 14 * (k.power - 0.5));
        for (let j = 0; j < count; j++) {
            const th = rng() * TAU, r2 = rng(), r3 = rng(), share = 0.25 + 0.75 * r3;
            const col = hex(pal(th / TAU * 0.5 + r2 * 0.5, 0.8), 1.25);
            const spread = (MAX_REACH - 1) * k.power;
            // Drawn straight up and turned to its direction, so one number moves it.
            spray += `<path transform="rotate(${n1(th * 360 / TAU)})" stroke="${col}" stroke-width="${n1(2 + 1.4 * r3)}" stroke-linecap="round" opacity="0">`
                + liveAnim(["d", "opacity"], k.time, k.time + 1.6, (t, live) => {
                    const age = live ? ageOf(t, k) : 0, ease = Math.exp(-age * 3.5), st = at(t);
                    const rs = 1 + st.swell + spread * share * (1 - ease);
                    const trail = clamp(spread * share * 3.5 * ease * 0.06, 0.008, 0.12);
                    return [`M0 ${Math.round(-rs * R)}V${Math.round(-(rs - trail) * R)}`, live ? n2(clamp(k.power * Math.exp(-age * (1.4 + 1.2 * r2)) * 1.4)) : 0];
                }, 10) + `</path>`;
        }
    }

    // The Hour Points: hourPoints() itself, flashing as a Shockwave's front reaches them.
    const points = perFrame(i => shaped(i, st => hourPoints({
        values: st.values, flow: st.flow, time: st.t, treble: st.treble, swell: st.swell, presence: st.presence, bassStretch: BASS_STRETCH,
        crossing: (radius, angle) => shockwaveCrossing(radius, st.slots.ages, st.slots.powers, st.slots.seeds, angle),
        surge: surgeOf(st),
    }).map(p => [p.radius, p.glow])));
    const hourSvg = Array.from({ length: 12 }, (_, h) => {
        const theta = h * TAU / 12, quarter = h % 3 === 0;
        const xy = points.map(p => polar(p[h][0], theta));
        const glow = points.map(p => p[h][1]);
        return `<g><animateTransform attributeName="transform" type="translate" dur="${LOOP}s" repeatCount="indefinite" values="${xy.map(p => `${n1(p[0])} ${n1(p[1])}`).join(";")}"/>`
            + `<circle r="${n1(0.045 * R)}" fill="#b4befe" opacity="0.25">${anim("opacity", glow.map(g => n2(clamp(0.22 * g))))}</circle>`
            + `<circle r="${n1((quarter ? 0.02 : 0.016) * R)}" fill="${quarter ? "#eef0ff" : "#c9cffd"}">${anim("r", glow.map(g => n1((quarter ? 0.017 : 0.013) * R * (0.8 + 0.5 * g))))}${anim("opacity", glow.map(g => n2(clamp(0.45 + 0.55 * g))))}</circle>`
            + `</g>`;
    }).join("");

    // The Hands: handPoses() at 10:08, each a neon wave ribbon of three strands (ring.frag hand()).
    const handNames = ["hour", "minute", "second"];
    const handColors = [LAVENDER, MAUVE, PINK];
    const poseAt = st => handPoses(new Date(CLOCK.getTime() + st.t * 1000), st.levels, { flash: handFlash(st.slots.ages, st.slots.powers, KICK_DECAY) });
    const handStrand = (name, index, k) => st => {
        const pose = poseAt(st)[name];
        const angle = pose.angle * TAU / 360;
        const dir = [Math.sin(angle), -Math.cos(angle)], side = [Math.cos(angle), Math.sin(angle)];
        const phase = st.phases[name] * (1 + 0.5 * k) + 2.1 * k + index * 1.3, amp = pose.amplitude * (1 - 0.22 * k);
        const pts = [];
        const n = k === 0 ? 18 : 12;
        for (let i = 0; i <= n; i++) {
            const u = i / n, along = pose.inner + u * (pose.length - pose.inner);
            const off = waveOffset(u, phase, amp, st.treble);
            pts.push([(dir[0] * along + side[0] * off) * R, (dir[1] * along + side[1] * off) * R]);
        }
        return pts;
    };
    let handsSvg = "", handDefs = "";
    for (const [index, name] of handNames.entries()) {
        const col = hex(deepen(handColors[index], 1 + 1.5 * 0.9), 1.5);
        const look = perFrame(i => { const st = at(i / FPS), p = poseAt(st)[name]; return [p.width, clamp(p.glow + p.flash), p.flash]; });
        // The second hand moves on through the loop, so it dims across the seam instead of jumping
        // (and isn't crossfaded there, which would fold it in two).
        const second = name === "second";
        const seam = second ? perFrame(i => n2(smoothstep(0, 0.35, i / FPS) * (1 - smoothstep(LOOP - 0.35, LOOP, i / FPS)))) : null;
        const shape = (i, k) => second && i / FPS > LOOP - 0.35 ? handStrand(name, index, k)(states.get(i)) : shaped(i, handStrand(name, index, k));
        handsSvg += `<g>${seam ? anim("opacity", seam) : ""}`;
        // The other strands: hairlines that come in with the band and the Kick.
        for (const k of [2, 1])
            handsSvg += `<path fill="none" stroke="${hex(pal(index * 0.33 + k * 0.2, 0.9), 1.2)}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.2" transform="scale(0.5)">`
                + anim("d", perFrame(i => relPath(shape(i, k)))) + anim("opacity", look.map(([, g]) => n2(g * (0.6 - 0.15 * k)))) + `</path>`;
        // The main strand, the hand itself, in its color, and a white-hot copy that flashes on every Kick.
        const hid = `${id}h${index}`;
        handDefs += `<path id="${hid}" fill="none" stroke-linecap="round" stroke-linejoin="round">${anim("d", perFrame(i => relPath(shape(i, 0))))}</path>`;
        handsSvg += `<use href="#${hid}" transform="scale(0.5)" stroke="${col}">${anim("stroke-width", look.map(([w]) => n1(2 * Math.max(1.4, w * R))))}</use>`
            + `<use href="#${hid}" transform="scale(0.5)" stroke="#ffffff" stroke-width="4" opacity="0">${anim("opacity", look.map(([, , f]) => n2(0.7 * f)))}</use></g>`;
    }

    // The Center Punch: a white-lavender flash where every Shockwave is born.
    const punch = `<circle r="${n1(0.5 * R)}" fill="url(#${id}punch)" opacity="0">${anim("opacity", perFrame(i => { const st = at(i / FPS); return n3(clamp(centerPunch(st.slots.ages, st.slots.powers) * 1.1)); }))}</circle>`;

    // The Digital Time: below the center, splitting into lavender, mauve and blue copies and flaring
    // toward white as a Shockwave crosses it (timeHit() of shockwaveCrossing() at TIME_RADIUS).
    const font = TIME_FONT * side, top = TIME_TOP * R, base = top + font * 0.8;
    const hits = perFrame(i => { const st = at(i / FPS); return timeHit(shockwaveCrossing(TIME_RADIUS, st.slots.ages, st.slots.powers, st.slots.seeds, Math.PI)); });
    const timeText = (extra, inner = "") => `<text x="0" y="${n1(base)}" text-anchor="middle" font-size="${n1(font)}" font-weight="600" letter-spacing="1" ${extra}>${inner}10:08</text>`;
    const copies = TIME_HIT.split.map(([color], c) => timeText(`fill="${color}" opacity="0"`,
        anim("opacity", hits.map(h => n2(h.copies[c].opacity))) + `<animateTransform attributeName="transform" type="translate" dur="${LOOP}s" repeatCount="indefinite" values="${hits.map(h => `0 ${n1(h.copies[c].offset * font)}`).join(";")}"/>`)).join("");
    const whiteVals = hits.map(h => hex([0.804, 0.839, 0.957].map(c => lerp(c, 1, h.white))));
    const timeSvg = `<g filter="url(#${id}soft2)">${copies}</g>`
        + `<g filter="url(#${id}timeglow)" opacity="0">${anim("opacity", hits.map(h => n2(h.glow.opacity)))}${timeText(`fill="${TIME_HIT.glow.color}"`)}</g>`
        + timeText(`fill="#cdd6f4"`, anim("fill", whiteVals));

    // The ribbons' and the Aura's colors run with the spectrum from the bottom (bass) up.
    const vgrad = (gid, offset, s, boost) => {
        const stops = [];
        for (let j = 0; j <= 6; j++)
            stops.push(`<stop offset="${n3(j / 6)}">${hueAnim("stop-color", offset + j / 6 * s, 36, 0.9, boost)}</stop>`);
        return `<linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="${n1(2.8 * R)}" x2="0" y2="${n1(-2.8 * R)}">${stops.join("")}</linearGradient>`;
    };
    const defs = `${[0, 1, 2].map(k => vgrad(`${id}rib${k}`, k * 0.33, 0.6, 1.2)).join("")}
  ${vgrad(`${id}aura`, 0.5, 0.8, 0.9)}
  <radialGradient id="${id}wake"><stop offset="0.45" stop-color="#cba6f7" stop-opacity="0"/><stop offset="0.85" stop-color="#b4befe" stop-opacity="0.25"/><stop offset="1" stop-color="#cba6f7" stop-opacity="0.55"/></radialGradient>
  <radialGradient id="${id}punch"><stop offset="0" stop-color="#ffffff"/><stop offset="0.3" stop-color="#d9deff" stop-opacity="0.7"/><stop offset="1" stop-color="#b4befe" stop-opacity="0"/></radialGradient>
  <filter id="${id}timeglow" x="-50%" y="-80%" width="200%" height="260%"><feGaussianBlur stdDeviation="${n1(TIME_HIT.glow.radius * font * 0.45)}"/></filter>
  <filter id="${id}soft2" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="${n1(TIME_HIT.soften * font * 1.5)}"/></filter>
  <filter id="${id}shock" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5"/></filter>
  <mask id="${id}fade"><radialGradient id="${id}fadeg"><stop offset="0.86" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient><circle r="${side / 2}" fill="url(#${id}fadeg)"/></mask>
  ${shockDefs}${handDefs}`;
    const body = `<g transform="translate(${cx} ${cy})" mask="url(#${id}fade)">
  <g filter="url(#auraBlur)">${auraSvg}</g>
  <g filter="url(#glow)">${shockSvg}</g>
  <g>${anim("opacity", presence)}<g filter="url(#glow)">${strands}</g></g>
  <g filter="url(#glow)">${beadSvg}${spray}</g>
  <g filter="url(#handglow)">${handsSvg}</g>
  ${punch}
  <g filter="url(#glow)">${hourSvg}</g>
  ${timeSvg}
</g>`;
    return { defs, body, R };
}

// The filters both panels share.
const SHARED_DEFS = `
  <filter id="glow" x="-10%" y="-60%" width="120%" height="220%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="wide"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="tight"/>
    <feMerge><feMergeNode in="wide"/><feMergeNode in="wide"/><feMergeNode in="tight"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="handglow" x="-30%" y="-30%" width="160%" height="160%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="wide"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.2" result="tight"/>
    <feMerge><feMergeNode in="wide"/><feMergeNode in="tight"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="auraBlur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
  <filter id="blur40" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>`;

// A dim wallpaper of slow color blobs inside (x, y, w, h).
const wallpaper = (x, y, w, h, dim = 1) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#wall)"/>
  <g filter="url(#blur40)" opacity="${dim}">
    <circle cx="${x + w * 0.18}" cy="${y + h * 0.9}" r="${h * 0.7}" fill="#cba6f7" opacity="0.10"><animate attributeName="cx" dur="18s" repeatCount="indefinite" values="${x + w * 0.18};${x + w * 0.27};${x + w * 0.18}"/></circle>
    <circle cx="${x + w * 0.82}" cy="${y + h}" r="${h * 0.8}" fill="#89b4fa" opacity="0.10"><animate attributeName="cx" dur="22s" repeatCount="indefinite" values="${x + w * 0.82};${x + w * 0.72};${x + w * 0.82}"/></circle>
  </g>`;
const caption = (x, y, text) => `<text x="${x}" y="${y}" fill="#a6adc8" fill-opacity="0.75" font-size="12" font-weight="600" letter-spacing="2.5">${text.toUpperCase()}</text>`;
const svgOpen = (w, h, label, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">
<title>${title}</title>`;

// --- The buzzwords --------------------------------------------------------------------------------
// Slang that slams in on the build's Kicks, one word replacing the last, and stamps the drop:
// "pov: ur bar lowkey SLAPS. ATE. no crumbs." Every landing comes in huge and tilted, overshoots,
// flashes white, splits into the Shockwave's colors, shakes and glitches, all on keyTimes, so it
// costs next to nothing. Everything is gone again before the loop ends.
//   text, landing time, where (center x, baseline y), font size, tilt, when it leaves, and for the
//   words that stay: the later Kicks that hit them again
const BUZZ = [
    { text: "pov:", t0: 1.5, x: 250, y: 352, size: 44, rot: -4, out: 2.0 },
    { text: "ur bar", t0: 2.0, x: 250, y: 356, size: 54, rot: 3, out: 2.5 },
    { text: "lowkey", t0: 2.5, x: 250, y: 360, size: 62, rot: -5, out: 3.0 },
    { text: "SLAPS", t0: 3.0, x: 250, y: 366, size: 80, rot: 4, out: 3.36 },
    { text: "ATE.", t0: DROP, x: 262, y: 452, size: 168, rot: -7, out: 5.45, hits: [4.0, 4.5, 5.0], drop: true },
    { text: "no crumbs.", t0: 4.5, x: 408, y: 480, size: 30, rot: 8, out: 5.45, sticker: true },
];
const n4 = x => (Math.round(x * 1e4) / 1e4).toString();
// An attribute through [time, value] keys (seconds), held at the first and last values out to the
// loop's ends.
function keyed(keys, { attr, type, mode = "linear", additive = false }) {
    const k = keys.map(([t, v]) => [clamp(t, 0, LOOP), v]).sort((p, q) => p[0] - q[0]);
    if (k[0][0] > 0) k.unshift([0, k[0][1]]);
    if (k[k.length - 1][0] < LOOP) k.push([LOOP, k[k.length - 1][1]]);
    for (let i = 1; i < k.length; i++) if (k[i][0] <= k[i - 1][0]) k[i][0] = k[i - 1][0] + 1e-4 * LOOP;
    const tag = type ? `animateTransform attributeName="transform" type="${type}"` : `animate attributeName="${attr}"`;
    return `<${tag} dur="${LOOP}s" repeatCount="indefinite" calcMode="${mode}"${additive ? ` additive="sum"` : ""} keyTimes="${k.map(x => n4(Math.min(1, x[0] / LOOP))).join(";")}" values="${k.map(x => x[1]).join(";")}"/>`;
}
function buzzwords() {
    const rng = mulberry(77);
    const out = [];
    for (const w of BUZZ) {
        const { t0, size } = w;
        const hits = [t0, ...(w.hits ?? [])];
        const textEl = (extra, inner = "") => `<text x="0" y="0" text-anchor="middle" font-size="${size}" font-weight="900" letter-spacing="${w.drop ? -4 : 0}" font-style="${w.drop || w.sticker ? "normal" : "italic"}" ${extra}>${inner}${w.text}</text>`;
        // Visible from the slam to the exit; the stayers flicker out, the others blink away as the next lands.
        const vis = w.drop || w.sticker
            ? [[t0 - 0.002, 0], [t0 + 0.02, 1], [w.out, 1], [w.out + 0.03, 0], [w.out + 0.06, 1], [w.out + 0.1, 0], [w.out + 0.13, 0.8], [w.out + 0.2, 0]]
            : [[t0 - 0.002, 0], [t0 + 0.02, 1], [w.out - 0.002, 1], [w.out + 0.05, 0]];
        // The slam: from 4.5x, overshooting, then a pulse on every later hit; blown up on the way out.
        const scale = [[t0 - 0.002, 4.5], [t0 + 0.07, 0.84], [t0 + 0.13, 1.1], [t0 + 0.2, 0.96], [t0 + 0.28, 1]];
        for (const h of hits.slice(1)) scale.push([h - 0.002, 1], [h + 0.04, 1.12], [h + 0.18, 1]);
        scale.push([w.out, 1], [w.out + 0.2, w.drop || w.sticker ? 1.25 : 1.8], [LOOP, 4.5]);
        const tilt = [[t0 - 0.002, w.rot + (w.rot < 0 ? -28 : 28)], [t0 + 0.07, w.rot - Math.sign(w.rot) * 4], [t0 + 0.16, w.rot], [LOOP - 0.01, w.rot], [LOOP, w.rot + (w.rot < 0 ? -28 : 28)]];
        // A hard shake for a few frames after every hit, dying out.
        const shake = [[0, "0 0"]];
        for (const h of hits) {
            for (let j = 0; j < 9; j++) {
                const amp = size * (h === t0 ? 0.09 : 0.05) * (1 - j / 9);
                shake.push([h + 0.06 + j * 0.03, `${n1((rng() - 0.5) * 2 * amp)} ${n1((rng() - 0.5) * 2 * amp)}`]);
            }
            shake.push([h + 0.06 + 9 * 0.03, "0 0"]);
        }
        // The chromatic split: lavender, mauve and blue copies thrown apart on impact, snapping back.
        const split = (c, dir) => {
            const keys = [[0, "0 0"]];
            for (const h of hits) {
                const k = h === t0 ? 1 : 0.6, off = TIME_HIT.split[c][1] * size * k;
                keys.push([h + 0.05, "0 0"], [h + 0.07, `${n1(dir * off * 1.6)} ${n1(off * 0.5)}`], [h + 0.5, `${n1(dir * off * 0.2)} 0`], [h + 0.8, "0 0"]);
            }
            return keys;
        };
        const splitOp = [[0, 0]];
        for (const h of hits) splitOp.push([h + 0.05, 0], [h + 0.07, 0.95], [h + 0.7, 0]);
        const copies = TIME_HIT.split.map(([color], c) => `<g opacity="0">${keyed(splitOp, { attr: "opacity" })}${keyed(split(c, c - 1 || 0.6), { type: "translate" })}`
            + textEl(`fill="${color}"`) + `</g>`).join("");
        // Glitch slices: bands of the word knocked sideways for a few frames after every hit.
        const bands = [[-0.62, 0.16], [-0.34, 0.12], [-0.12, 0.1]];
        const slices = bands.map(([top, height], j) => {
            const id = `gl${BUZZ.indexOf(w)}_${j}`;
            const op = [[0, 0]], dx = [[0, "0 0"]];
            for (const h of [...hits, w.out]) {
                for (let f = 0; f < 5; f++) {
                    const t = h + 0.07 + f * 0.04 + j * 0.013;
                    op.push([t, rng() > 0.3 ? 1 : 0]);
                    dx.push([t, `${n1((rng() - 0.5) * size * 0.5)} 0`]);
                }
                op.push([h + 0.07 + 5 * 0.04 + j * 0.013, 0]);
            }
            return `<clipPath id="${id}"><rect x="${-size * 4}" y="${n1(top * size)}" width="${size * 8}" height="${n1(height * size)}"/></clipPath>`
                + `<g clip-path="url(#${id})"><g opacity="0">${keyed(op, { attr: "opacity", mode: "discrete" })}${keyed(dx, { type: "translate", mode: "discrete" })}`
                + textEl(`fill="${j === 1 ? "#f5c2e7" : "#ffffff"}"`) + `</g></g>`;
        }).join("");
        // The white flash on impact.
        const flashOp = [[0, 0]];
        for (const h of hits) flashOp.push([h + 0.05, 0], [h + 0.07, 1], [h + 0.22, 0]);
        const flash = `<g opacity="0">${keyed(flashOp, { attr: "opacity" })}${textEl(`fill="#ffffff" filter="url(#buzzglow)"`)}${textEl(`fill="#ffffff"`)}</g>`;

        let behind = "";
        if (w.drop) {
            // Burst lines and two impact rings behind the drop's word.
            const rays = Array.from({ length: 16 }, (_, j) => {
                const th = TAU * (j + 0.3 * rng()) / 16, r0 = size * 0.55, r1 = size * (1.1 + 0.6 * rng());
                return `M${n1(Math.cos(th) * r0)} ${n1(Math.sin(th) * r0 - size * 0.35)}L${n1(Math.cos(th) * r1)} ${n1(Math.sin(th) * r1 - size * 0.35)}`;
            }).join("");
            const burstKeys = [[0, 0]];
            const burstScale = [[0, 0.3]];
            for (const h of hits) { burstKeys.push([h + 0.05, 0], [h + 0.07, h === t0 ? 1 : 0.5], [h + 0.45, 0]); burstScale.push([h + 0.05, 0.3], [h + 0.45, 1.5]); }
            behind += `<g opacity="0">${keyed(burstKeys, { attr: "opacity" })}<g transform="translate(0 ${n1(-size * 0.35)})"><g>${keyed(burstScale, { type: "scale" })}`
                + `<path transform="translate(0 ${n1(size * 0.35)})" d="${rays}" stroke="#f5c2e7" stroke-width="5" stroke-linecap="round" fill="none"/></g></g></g>`;
            for (const [lag, color] of [[0, "#b4befe"], [0.07, "#cba6f7"], [0.14, "#89b4fa"]]) {
                const h = t0 + 0.06 + lag;
                behind += `<circle cx="0" cy="${n1(-size * 0.35)}" fill="none" stroke="${color}" r="20" stroke-width="12" opacity="0">`
                    + keyed([[h - 0.002, 20], [h + 0.55, size * 1.9]], { attr: "r" })
                    + keyed([[h - 0.002, 14], [h + 0.55, 1]], { attr: "stroke-width" })
                    + keyed([[h - 0.002, 0], [h, 0.95], [h + 0.55, 0]], { attr: "opacity" }) + `</circle>`;
            }
            // A mauve shadow slab under the word, sticker style.
            behind += `<g transform="translate(9 9)">${textEl(`fill="#cba6f7" fill-opacity="0.55"`)}</g>`;
        }
        let main;
        if (w.sticker) {
            const wd = size * 0.58 * w.text.length + size * 0.8, ht = size * 1.5;
            main = `<rect x="${n1(-wd / 2)}" y="${n1(-size * 1.05)}" width="${n1(wd)}" height="${n1(ht)}" rx="${n1(ht / 2)}" fill="#f5c2e7" stroke="#11111b" stroke-width="4"/>`
                + textEl(`fill="#11111b"`);
        } else
            main = textEl(`fill="url(#buzz${w.drop ? "Drop" : ""})" stroke="#11111b" stroke-width="${w.drop ? 8 : 4}" paint-order="stroke" stroke-linejoin="round"`);
        out.push(`<g transform="translate(${w.x} ${w.y})"><g opacity="0">${keyed(vis, { attr: "opacity" })}`
            + `<g>${keyed(shake, { type: "translate", mode: "discrete" })}<g>${keyed(tilt, { type: "rotate" })}<g>${keyed(scale, { type: "scale" })}`
            + behind + `<g filter="url(#buzzsoft)">${copies}</g>` + main + slices + flash
            + `</g></g></g></g></g>`);
    }
    // The drop hits the whole picture: a white flash over everything.
    const frameFlash = keyed([[DROP + 0.05, 0], [DROP + 0.07, 0.38], [DROP + 0.3, 0], [4.0 + 0.05, 0], [4.0 + 0.07, 0.12], [4.0 + 0.2, 0]], { attr: "opacity" });
    return { words: out.join(""), flash: `<rect width="100%" height="100%" fill="#ffffff" opacity="0">${frameFlash}</rect>` };
}
const BUZZ_DEFS = `<linearGradient id="buzz" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#b4befe"/><stop offset="0.5" stop-color="#cba6f7"/><stop offset="1" stop-color="#f5c2e7"/></linearGradient>
  <linearGradient id="buzzDrop" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#f5c2e7"/><stop offset="1" stop-color="#cba6f7"/></linearGradient>
  <filter id="buzzsoft" x="-20%" y="-60%" width="140%" height="220%"><feGaussianBlur stdDeviation="1.2"/></filter>
  <filter id="buzzglow" x="-40%" y="-100%" width="180%" height="300%"><feGaussianBlur stdDeviation="10"/></filter>`;

// --- The hero ------------------------------------------------------------------------------------
function hero() {
    // One scene: the bar cuts across the Lock Ring's upper third, right of center, so the ring's
    // Ribbons, Shockwaves and Spray run over the bar and both hit on the same beat. The
    // ring draws over the bar's light (its glow bleeds across the bar's bottom edge), and the bar's
    // widgets draw over both, so they stay legible.
    const W = 1200, H = 580;
    const bar = barPanel({ x: 24, y: 152, w: 1152, h: 76, widgets: false });
    const ring = ringPanel({ cx: 820, cy: 300, side: 540 });
    const buzz = buzzwords();
    return `${svgOpen(W, H, "Animated preview: the Bar Visualizer's neon Ribbons and Shockwaves behind a top bar, and the Lock Ring's Ribbons, Shockwaves and Hands around a clock, both hitting on the same beat", "dms-bar-visualizer preview")}
<defs>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#181825"/><stop offset="1" stop-color="#0b0b12"/></linearGradient>
  ${SHARED_DEFS}
  ${bar.defs}
  ${ring.defs}
  ${BUZZ_DEFS}
  <linearGradient id="barfadeg" gradientUnits="userSpaceOnUse" x1="620" y1="0" x2="960" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="0.55" stop-color="#fff" stop-opacity="0.3"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
  <mask id="barfade" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#barfadeg)"/></mask>
</defs>
<g clip-path="url(#frame)" ${FONT}>
  ${wallpaper(0, 0, W, H)}
  <g mask="url(#barfade)">${bar.body}</g>
  ${ring.body}
  <g mask="url(#barfade)"><g transform="translate(24 152)">${barWidgets(1152, 76)}</g></g>
  <text x="64" y="76" fill="#cdd6f4" fill-opacity="0.95" font-size="40" font-weight="800" letter-spacing="0.5">dms-bar-visualizer</text>
  <text x="66" y="106" fill="#a6adc8" font-size="16">Music visualizers for DankMaterialShell:</text>
  <text x="66" y="128" fill="#a6adc8" font-size="16">behind the top bar, and on the lock screen.</text>
  ${buzz.words}
  ${buzz.flash}
</g>
</svg>
`;
}

// --- Layer diagram ---------------------------------------------------------------------------------
function layers() {
    const w = 900, h = 300, pw = 420, ph = 70, skew = 90, cx0 = 120, cy0 = 150;
    const defsL = [
        ["top layer", "DankBar · transparent background", "#cdd6f4", "#cdd6f4", -1],
        ["bottom layer", "Bar Visualizer · click-through", "#cba6f7", "#b4befe", 0],
        ["background", "wallpaper", "#89b4fa", "#89b4fa", 1],
    ];
    const out = [];
    for (const idx of [2, 1, 0]) {
        const [label, sub, fill, stroke, off] = defsL[idx];
        const yRest = off * 22, ySplit = off * 72, x0 = cx0;
        const poly = `${x0 + skew},${cy0 - ph / 2} ${x0 + skew + pw},${cy0 - ph / 2} ${x0 + pw},${cy0 + ph / 2} ${x0},${cy0 + ph / 2}`;
        let inner = "";
        if (idx === 1) {
            const d = [];
            for (let f = 0; f <= 40; f++) {
                const p = TAU * f / 40, pts = [];
                for (let i = 0; i <= 40; i++) {
                    const u = i / 40;
                    pts.push(`${n1(x0 + 30 + u * (pw - 60) + skew * 0.5)} ${n1(cy0 + 18 * Math.sin(Math.abs(u - 0.5) * 18 - p * 2) * (0.35 + 0.65 * Math.exp(-Math.abs(u - 0.5) * 4)))}`);
                }
                d.push("M" + pts.join("L"));
            }
            inner = `<path fill="none" stroke="#f5c2e7" stroke-width="2.4" filter="url(#lglow)"><animate attributeName="d" dur="2.4s" repeatCount="indefinite" values="${d.join(";")}"/></path>`;
        }
        if (idx === 0)
            inner = [[30, 80], [pw / 2 - 50, 100], [pw - 110, 80]].map(([dx, ww]) => `<rect x="${x0 + skew * 0.5 + dx}" y="${cy0 - 8}" width="${ww}" height="16" rx="8" fill="#cdd6f4" fill-opacity="0.5"/>`).join("");
        const fillOp = { 0: 0.06, 1: 0.10, 2: 0.16 }[idx], tx = x0 + pw + skew + 40;
        out.push(`<g><animateTransform attributeName="transform" type="translate" dur="7s" repeatCount="indefinite" values="0 ${yRest};0 ${yRest};0 ${ySplit};0 ${ySplit};0 ${yRest}" keyTimes="0;0.15;0.4;0.75;1" calcMode="spline" keySplines="0 0 1 1;0.65 0 0.35 1;0 0 1 1;0.65 0 0.35 1"/>`
            + `<polygon points="${poly}" fill="${fill}" fill-opacity="${fillOp}" stroke="${stroke}" stroke-opacity="0.7" stroke-width="1.5" stroke-linejoin="round"/>${inner}`
            + `<line x1="${x0 + pw + skew / 2 + 8}" y1="${cy0}" x2="${tx - 8}" y2="${cy0}" stroke="${stroke}" stroke-opacity="0.35" stroke-dasharray="3 4"/>`
            + `<text x="${tx}" y="${cy0 - 3}" fill="${stroke}" font-size="17" font-weight="700">${label}</text>`
            + `<text x="${tx}" y="${cy0 + 18}" fill="#a6adc8" font-size="13">${sub}</text></g>`);
    }
    return `${svgOpen(w, h, "Layer diagram: the transparent DankBar on the top layer, the Bar Visualizer on the bottom layer, the wallpaper below", "Wayland layers")}
<defs><filter id="lglow" x="-10%" y="-80%" width="120%" height="260%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
<rect width="${w}" height="${h}" rx="18" fill="#181825"/>
<g ${FONT}>${out.join("")}</g>
</svg>
`;
}

// --- The labeled animations ------------------------------------------------------------------------
// The same panels and loop as the hero, with every part named as in GLOSSARY.md. Labels stay put,
// each with a thin leader to a spot its part keeps to, and light up when their part acts.
const LIT_DEFS = `<filter id="labelglow" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
// A label at (x, y) (text-anchor `anchor`), its hint below, and a leader from the label's side to
// the target (tx, ty), with an elbow at the label's height. `active`: one 0..1 value per frame, or
// null for a part that stays steady.
function label({ x, y, anchor = "start", name, hint, tx, ty, active = null, elbowX }) {
    const sx = anchor === "end" ? x + 10 : anchor === "start" ? x - 10 : x;
    const sy = anchor === "middle" ? (ty < y ? y - 22 : y + 22) : y - 5;
    const ex = elbowX ?? (anchor === "middle" ? sx : lerp(sx, tx, 0.35));
    const leader = anchor === "middle" ? `M${n1(sx)} ${n1(sy)}L${n1(tx)} ${n1(ty)}` : `M${n1(sx)} ${n1(sy)}H${n1(ex)}L${n1(tx)} ${n1(ty)}`;
    const text = (fill, extra = "") => `<text x="${x}" y="${y}" text-anchor="${anchor}" fill="${fill}" font-size="16" font-weight="650" ${extra}>${name}</text>`;
    const base = `<path d="${leader}" fill="none" stroke="#7f849c" stroke-opacity="0.7" stroke-width="1.2"/>`
        + `<circle cx="${n1(tx)}" cy="${n1(ty)}" r="3" fill="none" stroke="#b4befe" stroke-opacity="0.8" stroke-width="1.4"/>`
        + text("#cdd6f4")
        + (hint ? `<text x="${x}" y="${y + 18}" text-anchor="${anchor}" fill="#a6adc8" font-size="12">${hint}</text>` : "");
    if (!active) return `<g>${base}</g>`;
    const lit = `<g opacity="0" filter="url(#labelglow)">${anim("opacity", active.map(v => n2(clamp(v))))}`
        + `<path d="${leader}" fill="none" stroke="#f5c2e7" stroke-width="1.8"/>`
        + `<circle cx="${n1(tx)}" cy="${n1(ty)}" r="4.5" fill="#f5c2e7"/>`
        + text("#ffffff") + `</g>`;
    return `<g>${base}${lit}</g>`;
}
// How strongly the Kicks act at frame i: the newest live Kick's strength fading at `fade` per second.
const kickActivity = (fade, gain = 1.3) => perFrame(i => {
    const st = at(i / FPS);
    let v = 0;
    st.slots.ages.forEach((age, j) => { v = Math.max(v, st.slots.powers[j] * Math.exp(-age * fade)); });
    return clamp(v * gain);
});

function barAnatomy() {
    const W = 1200, H = 320, bx = 24, by = 122, bw = 1152, bh = 76, cy = by + bh / 2;
    const bar = barPanel({ x: bx, y: by, w: bw, h: bh, widgets: false });
    const labels = [
        // Above the bar.
        { x: 150, y: 58, anchor: "middle", name: "Ribbons", hint: "the spectrum, as neon strands", tx: bx + 140, ty: cy - 6 },
        { x: 390, y: 58, anchor: "middle", name: "Spray", hint: "sparks a Kick flings out", tx: bx + 380, ty: by + 18, active: kickActivity(3) },
        { x: 600, y: 58, anchor: "middle", name: "Center Punch", hint: "where every Shockwave is born", tx: bx + bw / 2, ty: cy, active: perFrame(i => clamp(at(i / FPS).kick ** 2 * 1.6)) },
        { x: 880, y: 58, anchor: "middle", name: "Shockwave", hint: "one front per Kick, racing out", tx: bx + 860, ty: by + 8, active: kickActivity(2.2) },
        // Below it.
        { x: 150, y: 270, anchor: "middle", name: "Treble Sparks", hint: "twinkle with the treble", tx: bx + 120, ty: by + bh - 14, active: perFrame(i => smoothstep(0.35, 0.75, at(i / FPS).treble)) },
        { x: 470, y: 270, anchor: "middle", name: "Aura", hint: "the soft glow around the Ribbons", tx: bx + 460, ty: cy + 14 },
        { x: 1000, y: 270, anchor: "middle", name: "Haze", hint: "floods the bar on hard Kicks", tx: bx + 1000, ty: by + bh - 10, active: perFrame(i => clamp(at(i / FPS).kick ** 2 * 2)) },
    ];
    return `${svgOpen(W, H, "Labeled animation of the Bar Visualizer: Ribbons, Aura, Shockwave, Spray, Center Punch, Haze and Treble Sparks, each label lighting up when its part acts", "Bar Visualizer, labeled")}
<defs>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#181825"/><stop offset="1" stop-color="#0b0b12"/></linearGradient>
  ${SHARED_DEFS}
  ${LIT_DEFS}
  ${bar.defs}
</defs>
<g clip-path="url(#frame)" ${FONT}>
  ${wallpaper(0, 0, W, H)}
  ${bar.body}
  ${labels.map(label).join("")}
</g>
</svg>
`;
}

function ringAnatomy() {
    const W = 1080, H = 660, cx = 540, cy = 330, side = 520;
    const ring = ringPanel({ cx, cy, side });
    const R = ring.R;
    const pt = (deg, r) => [cx + r * R * Math.sin(deg * TAU / 360), cy - r * R * Math.cos(deg * TAU / 360)];
    const [rbx, rby] = pt(305, 1.02), [dlx, dly] = pt(268, 1.0), [aux, auy] = pt(240, 1.2);
    const [shx, shy] = pt(28, 0.72), [hpx, hpy] = pt(90, 1.0), [spx, spy] = pt(138, 1.3);
    const minute = (8 + 24 / 60) * 6;
    const [hax, hay] = pt(minute, 0.5);
    const timeY = cy + (TIME_TOP * R + TIME_FONT * side * 0.45);
    const crossingAt = (radius, angle) => perFrame(i => { const st = at(i / FPS); return shockwaveCrossing(radius, st.slots.ages, st.slots.powers, st.slots.seeds, angle); });
    const left = 250, right = 830;
    const labels = [
        { x: left, y: 150, anchor: "end", name: "Ribbons", hint: "the spectrum, waving round", tx: rbx, ty: rby },
        { x: left, y: 285, anchor: "end", name: "Dial", hint: "swells with the music", tx: dlx, ty: dly },
        { x: left, y: 420, anchor: "end", name: "Aura", hint: "pushed out a little by a Kick", tx: aux, ty: auy, active: perFrame(i => { const st = at(i / FPS); return clamp(auraPush(st.slots.ages, st.slots.powers) * 1.4); }) },
        { x: left, y: 555, anchor: "end", name: "Center Punch", hint: "where every Shockwave is born", tx: cx, ty: cy, elbowX: 380, active: perFrame(i => { const st = at(i / FPS); return clamp(centerPunch(st.slots.ages, st.slots.powers) * 1.4); }) },
        { x: right, y: 130, name: "Shockwave", hint: "ragged, with Beads riding it", tx: shx, ty: shy, active: kickActivity(2.2) },
        { x: right, y: 260, name: "Hands", hint: "swing, flash, always the true time", tx: hax, ty: hay, active: perFrame(i => { const st = at(i / FPS); return clamp(handFlash(st.slots.ages, st.slots.powers, KICK_DECAY) * 1.3); }) },
        { x: right, y: 360, name: "Hour Points", hint: "flash as the front reaches them", tx: hpx, ty: hpy, active: crossingAt(1, Math.PI / 2).map(v => clamp(v * 1.6)) },
        { x: right, y: 470, name: "Digital Time", hint: "splits as a Shockwave crosses", tx: cx + 64, ty: timeY, active: crossingAt(TIME_RADIUS, Math.PI).map(v => clamp(v * 1.6)) },
        { x: right, y: 580, name: "Spray", hint: "sparks flung off the ring", tx: spx, ty: spy, active: kickActivity(2.5) },
    ];
    return `${svgOpen(W, H, "Labeled animation of the Lock Ring: Ribbons, Aura, Dial, Hour Points, Hands, Digital Time, Shockwave with Beads, Spray and Center Punch, each label lighting up when its part acts", "Lock Ring, labeled")}
<defs>
  <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#181825"/><stop offset="1" stop-color="#0b0b12"/></linearGradient>
  ${SHARED_DEFS}
  ${LIT_DEFS}
  ${ring.defs}
</defs>
<g clip-path="url(#frame)" ${FONT}>
  ${wallpaper(0, 0, W, H)}
  ${ring.body}
  ${labels.map(label).join("")}
</g>
</svg>
`;
}

const files = { "hero.svg": hero(), "bar-anatomy.svg": barAnatomy(), "ring-anatomy.svg": ringAnatomy(), "layers.svg": layers() };
for (const [name, svg] of Object.entries(files)) {
    writeFileSync(join(OUT, name), svg);
    console.log(`${name}: ${Math.round(statSync(join(OUT, name)).size / 1024)} KiB`);
}

// The Lock Ring's Lyric Words, apart from drawing: where each letter of a word sits on its Ribbon
// or Hand, the colour it glows in there, and how it pops in, takes a Shockwave and dissolves.
// docs/lyric-words.mjs says which words show and where they landed (their spot); this turns a spot
// into pixels on the ring, frame by frame, as the Ribbons wave and the Hands turn. Plain JS for
// tests/lock-lyrics.test.mjs; LockRing.qml draws from it (it must pass Qt's JS engine, so no
// object spread).
//
// The Ribbons' shape and the Hands' are ring.frag's, through ring.mjs, kicks.mjs and hands.mjs; the
// few numbers ring.frag spells out inline (how loud a Ribbon waves, its hue, a Hand's wave phase
// and colour) are mirrored here, and tests/lock-constants.test.mjs keeps them on ring.frag's.
import { timeHit } from "./clock.mjs";
import { HANDS, waveOffset } from "./hands.mjs";
import { ribbonSurge } from "./kicks.mjs";
import { ribbonLevel, ribbonRadius, spectrumAt } from "./ring.mjs";

// A lead vocal's font size, as a share of the ring's side (as the Digital Time's TIME_FONT is).
export const WORD_FONT = 0.024;

// Catppuccin Mocha, ring.frag's LAVENDER, MAUVE, PINK and BLUE.
export const COLORS = { lavender: "#b4befe", mauve: "#cba6f7", pink: "#f5c2e7", blue: "#89b4fa" };
// ring.frag's palette() cycle, and its pal()'s saturation for the Ribbons and the Hands.
export const PALETTE = ["lavender", "mauve", "lavender", "pink", "lavender", "blue", "lavender"];
export const SATURATION = 0.9;
// ring.frag's Ribbons: how loud they wave with the music (music = gain * ribbonSpectrum(s) *
// (1 + kick * ubuf.kick)), and their hue (hueBase = time * t + s * spectrum; pal(hueBase +
// ribbon * k + along * s + level * level)).
export const RIBBON_MUSIC = { gain: 1.3, kick: 0.7 };
export const RIBBON_HUE = { time: 0.05, spectrum: 0.15, ribbon: 0.33, along: 0.6, level: 0.2 };
// Each hand's colour in ring.frag (hour, minute, second), and how far its wave's phase is offset
// by its index (phase = wave + index * HAND_PHASE, for its main wave).
export const HAND_COLORS = { hour: "lavender", minute: "mauve", second: "pink" };
export const HAND_PHASE = 1.3;

// How a word looks as it pops in and dissolves (wordLook()):
//   grow          how much oversized a word lands, at the hardest pop (lyric-words.mjs pop, 1)
//   flash         how far toward white it flares as it lands, at the hardest pop
//   fadeIn        the share of its pop-in it takes to fade in
//   dissolveGrow  how much it widens as it dissolves, blurring away
//   core          how far toward white its letters are, so they glow with a bright core
//   glow          its glow's blur radius, in font sizes, and how much wider than the letters it
//                 spreads (a share of their size)
export const WORD_LOOK = { grow: 0.6, flash: 0.9, fadeIn: 0.3, dissolveGrow: 0.25, core: 0.45, glow: { radius: 0.6, spread: 0.06 } };

const TAU = 2 * Math.PI;
// The hands, in ring.frag's order (hour, minute, second): their index offsets their phase.
const NAMES = Object.keys(HANDS);
const clamp01 = x => Math.min(1, Math.max(0, x));
const fract = x => x - Math.floor(x);
const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
const hex = c => "#" + c.map(v => Math.round(clamp01(v) * 255).toString(16).padStart(2, "0")).join("");

// ring.frag's pal(h, SATURATION, 1): palette() at hue h, deepened. The colours' own channels.
function pal(h) {
    const f = fract(h) * 6;
    const i = Math.floor(f);
    const t = fract(f), m = t * t * (3 - 2 * t);
    const a = rgb(COLORS[PALETTE[i]]), b = rgb(COLORS[PALETTE[i + 1]]);
    return a.map((v, j) => Math.pow(v + (b[j] - v) * m, 1 + 1.5 * SATURATION));
}

// A colour at full brightness: its brightest channel at 1, so a word glows as bright on a dim
// stretch of colour as on a light one.
const bright = c => {
    const top = Math.max(c[0], c[1], c[2], 1e-6);
    return hex(c.map(v => v / top));
};

// Ribbon `k`'s radius (dial radii) at `theta` (radians clockwise from 12 o'clock), as ring.frag
// draws it: the music's level there, surged by the Shockwaves where the Ribbon sits before the
// surge. With the level and the spectrum position, for its colour.
function ribbonAt(theta, k, scene) {
    const angle = theta * 180 / Math.PI;
    const s = spectrumAt(angle, scene.bassStretch);
    const music = RIBBON_MUSIC.gain * ribbonLevel(scene.values, s) * (1 + RIBBON_MUSIC.kick * scene.kick);
    const wave = { flow: scene.flow, time: scene.time, treble: scene.treble, swell: scene.swell, strand: k };
    const calm = ribbonRadius(angle, Object.assign({ level: Math.min(1, music) }, wave));
    const surge = ribbonSurge(calm, scene.kickAges, scene.kickPowers, scene.kickSeeds, theta);
    const level = Math.min(1, music + surge);
    return { radius: ribbonRadius(angle, Object.assign({ level }, wave)), level, s };
}

// Lays letters along a path: `point(t)` gives a point (px from the dial's center, y down) at `t`,
// `unit` px of the path per unit of t, walking in `read` (+1 or -1) direction. Each letter's center
// is its share of the word's advances from the word's middle at t0, turned to the path's tangent.
function layOut(advances, t0, unit, read, point) {
    const width = advances.reduce((sum, a) => sum + a, 0);
    const eps = 0.5 / unit;
    const glyphs = [];
    let before = 0;
    for (const advance of advances) {
        const t = t0 + read * (before + advance / 2 - width / 2) / unit;
        before += advance;
        const p = point(t), ahead = point(t + read * eps), behind = point(t - read * eps);
        glyphs.push({ x: p.x, y: p.y, rotation: Math.atan2(ahead.y - behind.y, ahead.x - behind.x) * 180 / Math.PI });
    }
    return { glyphs, width };
}

// Where a word sits on the ring this frame, from its `spot` (lyric-words.mjs: on a Ribbon at an
// angle, or on a Hand at a share along it), its letters' `advances` (px), and the `scene`:
//   dialRadius                          the dial's radius, px
//   values, flow, time, treble, swell,  the ring's inputs, as ring.frag's uniforms
//   kick, bassStretch
//   kickAges, kickPowers, kickSeeds     the pipeline's last Kicks, for the surge
//   poses                               hands.mjs handPoses()
//   phases                              each hand's wave phase (LockAudio.handPhases)
// Returns
//   glyphs     each letter's center (px from the dial's center, y down) and rotation (degrees),
//              lying along the Ribbon's curve or the Hand's wave, reading left to right and upright
//   x, y       the word's center, px from the dial's center
//   radius     the word's distance from the center, in dial radii, and theta its direction
//              (radians clockwise from 12 o'clock): where a Shockwave crosses it
//   color      the colour it glows in: its Ribbon's there, or its Hand's, at full brightness
export function wordPlacement(spot, advances, scene) {
    const D = scene.dialRadius;
    let laid, color;
    if (spot.on === "hand") {
        const index = Math.max(0, NAMES.indexOf(spot.hand));
        const name = NAMES[index];
        const pose = scene.poses[name];
        const a = pose.angle * Math.PI / 180;
        const dir = { x: Math.sin(a), y: -Math.cos(a) }, side = { x: Math.cos(a), y: Math.sin(a) };
        const span = pose.length - pose.inner;
        const phase = (scene.phases ? scene.phases[name] : 0) + index * HAND_PHASE;
        const point = u => {
            const along = pose.inner + u * span;
            const across = waveOffset(clamp01(u), phase, pose.amplitude, scene.treble);
            return { x: (dir.x * along + side.x * across) * D, y: (dir.y * along + side.y * across) * D };
        };
        // Outward on the right half, inward on the left, so it reads left to right.
        const read = dir.x >= -1e-9 ? 1 : -1;
        const width = advances.reduce((sum, w) => sum + w, 0);
        const half = width / 2 / (span * D);
        // On the Hand, or for a word longer than it, from its inner end, reaching past the tip by
        // up to half the Hand as its spot nears the tip, so words on it still land apart.
        const u0 = half >= 0.5 ? half + 0.5 * clamp01(spot.along) : Math.min(1 - half, Math.max(half, spot.along));
        laid = layOut(advances, u0, span * D, read, point);
        color = bright(rgb(COLORS[HAND_COLORS[name]]).map(v => Math.pow(v, 1 + 1.5 * SATURATION)));
    } else {
        const k = spot.ribbon;
        const theta0 = (((spot.angle % 360) + 360) % 360) * Math.PI / 180;
        const at = ribbonAt(theta0, k, scene);
        const point = theta => {
            const r = ribbonAt(theta, k, scene).radius * D;
            return { x: r * Math.sin(theta), y: -r * Math.cos(theta) };
        };
        // Clockwise over the top, counterclockwise along the bottom, so it reads left to right.
        const read = Math.cos(theta0) >= 0 ? 1 : -1;
        laid = layOut(advances, theta0, at.radius * D, read, point);
        const hue = RIBBON_HUE.time * scene.time + RIBBON_HUE.spectrum * at.s
            + RIBBON_HUE.ribbon * k + RIBBON_HUE.along * at.s + RIBBON_HUE.level * at.level;
        color = bright(pal(hue));
    }
    const mid = laid.glyphs.length ? laid.glyphs[Math.floor(laid.glyphs.length / 2)] : { x: 0, y: 0 };
    let x = mid.x, y = mid.y;
    if (laid.glyphs.length % 2 === 0 && laid.glyphs.length) {
        const before = laid.glyphs[laid.glyphs.length / 2 - 1];
        x = (x + before.x) / 2;
        y = (y + before.y) / 2;
    }
    const theta = Math.atan2(x, -y);
    return { glyphs: laid.glyphs, x, y, radius: Math.hypot(x, y) / D, theta: theta < 0 ? theta + TAU : theta, color };
}

// How a word looks this frame, from lyric-words.mjs's word (popIn, pop, dissolve, brightness) and
// how brightly a Shockwave's front is crossing it (`crossing`, 0..1: kicks.mjs shockwaveCrossing()
// at its radius and theta):
//   scale    its size factor: oversized as it lands, more with a Kick, settling to 1; a little
//            wider as it dissolves
//   opacity  fading in over its pop-in, dimmer for a background vocal, gone as it dissolves
//   white    how far it flares toward white: its landing flash and the Shockwave's flare
//   blur     how blurred it is, 0..1: it blurs away as it dissolves
//   hit      the Shockwave's split and glow, as the Digital Time takes it (clock.mjs timeHit())
export function wordLook(word, crossing) {
    const popIn = clamp01(word.popIn), pop = clamp01(word.pop), dissolve = clamp01(word.dissolve);
    const landing = (1 - popIn) * (1 - popIn);
    const hit = timeHit(crossing);
    return {
        scale: 1 + WORD_LOOK.grow * pop * landing + WORD_LOOK.dissolveGrow * dissolve,
        opacity: clamp01(word.brightness) * Math.min(1, popIn / WORD_LOOK.fadeIn) * (1 - dissolve),
        white: Math.min(1, WORD_LOOK.flash * pop * (1 - popIn) + hit.white),
        blur: dissolve,
        hit,
    };
}

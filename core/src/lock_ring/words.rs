// The Lock Ring's Lyric Words, apart from drawing: where each letter of a word sits on its Ribbon
// or Hand, the color it glows in there, and how it pops in, takes a Shockwave and dissolves.
// lyric_line.rs says which words show and where they landed (their Spot); this turns a spot into
// pixels on the ring, frame by frame, as the Ribbons wave and the Hands turn. Ported from v0.10.0's
// docs/lock-ring/lyrics.mjs. The Ribbons' shape and the Hands' are ring.frag's, through ring.rs,
// kicks.rs and hands.rs; the few numbers ring.frag spells out inline (how loud a Ribbon waves, its
// hue, a Hand's wave phase and color) are mirrored here.
use std::f64::consts::{PI, TAU};

use super::clock::{time_hit, TimeHit};
use super::hands::{wave_offset, HandPose};
use super::kicks::ribbon_surge;
use super::ring::{ribbon_level, ribbon_radius, spectrum_at, RibbonAt};
use crate::lyric_line::{LyricWord, Spot};

/// A lead vocal's font size, as a share of the ring's side (as the Digital Time's TIME_FONT is),
/// and the smallest it gets, in pixels.
pub const WORD_FONT: f64 = 0.024;
pub const WORD_FONT_MIN: f64 = 8.0;

/// Catppuccin Mocha, ring.frag's LAVENDER, MAUVE, PINK and BLUE, as 8-bit channels.
pub const RING_LAVENDER: [u8; 3] = [0xb4, 0xbe, 0xfe];
pub const RING_MAUVE: [u8; 3] = [0xcb, 0xa6, 0xf7];
pub const RING_PINK: [u8; 3] = [0xf5, 0xc2, 0xe7];
pub const RING_BLUE: [u8; 3] = [0x89, 0xb4, 0xfa];
/// ring.frag's palette() cycle, and its pal()'s saturation for the Ribbons and the Hands.
pub const RING_PALETTE: [[u8; 3]; 7] =
    [RING_LAVENDER, RING_MAUVE, RING_LAVENDER, RING_PINK, RING_LAVENDER, RING_BLUE, RING_LAVENDER];
pub const SATURATION: f64 = 0.9;
/// ring.frag's Ribbons: how loud they wave with the music (music = gain * ribbonSpectrum(s) * (1 +
/// kick * ubuf.kick)), and their hue (time * HUE_TIME + s * HUE_SPECTRUM + ribbon * HUE_RIBBON +
/// along * HUE_ALONG + level * HUE_LEVEL).
pub const RIBBON_MUSIC_GAIN: f64 = 1.3;
pub const RIBBON_MUSIC_KICK: f64 = 0.7;
pub const RIBBON_HUE_TIME: f64 = 0.05;
pub const RIBBON_HUE_SPECTRUM: f64 = 0.15;
pub const RIBBON_HUE_RIBBON: f64 = 0.33;
pub const RIBBON_HUE_ALONG: f64 = 0.6;
pub const RIBBON_HUE_LEVEL: f64 = 0.2;
/// Each Hand's color in ring.frag (hour, minute, second), and how far its wave's phase is offset by
/// its index (phase = wave + index * HAND_PHASE, for its main wave).
pub const HAND_COLORS: [[u8; 3]; 3] = [RING_LAVENDER, RING_MAUVE, RING_PINK];
pub const HAND_PHASE: f64 = 1.3;

/// How a word looks as it pops in and dissolves (word_look()):
///   GROW           how much oversized a word lands, at the hardest pop (a LyricWord's pop, 1)
///   FLASH          how far toward white it flares as it lands, at the hardest pop
///   FADE_IN        the share of its pop-in it takes to fade in
///   DISSOLVE_GROW  how much it widens as it dissolves, blurring away
///   CORE           how far toward white its letters are, so they glow with a bright core
///   GLOW_RADIUS    its glow's blur radius, in font sizes, and GLOW_SPREAD how much wider than the
///                  letters it spreads (a share of their size)
pub const WORD_LOOK_GROW: f64 = 0.6;
pub const WORD_LOOK_FLASH: f64 = 0.9;
pub const WORD_LOOK_FADE_IN: f64 = 0.3;
pub const WORD_LOOK_DISSOLVE_GROW: f64 = 0.25;
pub const WORD_LOOK_CORE: f64 = 0.45;
pub const WORD_LOOK_GLOW_RADIUS: f64 = 0.6;
pub const WORD_LOOK_GLOW_SPREAD: f64 = 0.06;

fn clamp01(x: f64) -> f64 {
    x.clamp(0.0, 1.0)
}

fn fract(x: f64) -> f64 {
    x - libm::floor(x)
}

fn rgb(c: [u8; 3]) -> [f64; 3] {
    c.map(|v| v as f64 / 255.0)
}

/// A channel to 8 bits and back, as v0.10.0's hex colors had it (JS Math.round).
fn byte(v: f64) -> f64 {
    libm::floor(clamp01(v) * 255.0 + 0.5) / 255.0
}

/// ring.frag's pal(h, SATURATION, 1): palette() at hue h, deepened.
fn pal(h: f64) -> [f64; 3] {
    let f = fract(h) * 6.0;
    let i = (libm::floor(f) as usize).min(5);
    let t = fract(f);
    let m = t * t * (3.0 - 2.0 * t);
    let (a, b) = (rgb(RING_PALETTE[i]), rgb(RING_PALETTE[i + 1]));
    std::array::from_fn(|j| libm::pow(a[j] + (b[j] - a[j]) * m, 1.0 + 1.5 * SATURATION))
}

/// A color at full brightness, its brightest channel at 1 (so a word glows as bright on a dim
/// stretch of color as on a light one), in 8-bit channels.
fn bright(c: [f64; 3]) -> [f64; 3] {
    let top = c[0].max(c[1]).max(c[2]).max(1e-6);
    c.map(|v| byte(v / top))
}

/// What a word's placement reads: the dial's radius (px), the ring's inputs as ring.frag's uniforms
/// (the bands, flow, the animation clock wrapped as the shader has it, treble, the ring's swell, the
/// Kick level, bassStretch), the Kick slots for the surge (the Frame's), each Hand's pose
/// (hand_poses()) and wave phase (LockRingFrame::hand_phases).
#[derive(Clone, Copy, Debug)]
pub struct WordScene<'a> {
    pub dial_radius: f64,
    pub values: &'a [f64],
    pub flow: f64,
    pub time: f64,
    pub treble: f64,
    pub swell: f64,
    pub kick: f64,
    pub bass_stretch: f64,
    pub kick_ages: &'a [f64],
    pub kick_powers: &'a [f64],
    pub kick_seeds: &'a [f64],
    pub poses: [HandPose; 3],
    pub phases: [f64; 3],
}

/// One letter of a placed word: its center, px from the dial's center (y down), and its rotation,
/// clockwise degrees.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct PlacedLetter {
    pub x: f64,
    pub y: f64,
    pub rotation: f64,
}

/// Where a word sits on the ring this frame: its middle, px from the dial's center (y down); its
/// distance from the center in dial radii and its direction (radians clockwise from 12 o'clock,
/// 0..2π), where a Shockwave crosses it; and the color it glows in (r, g, b 0..1, 8-bit), its
/// Ribbon's there or its Hand's, at full brightness.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WordPlacement {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
    pub theta: f64,
    pub color: [f64; 3],
}

/// A Ribbon's radius (dial radii) at `theta` (radians clockwise from 12 o'clock), as ring.frag
/// draws it, with the music's level there and the spectrum position, for its color.
fn ribbon_at(theta: f64, k: usize, scene: &WordScene) -> (f64, f64, f64) {
    let angle = theta * 180.0 / PI;
    let s = spectrum_at(angle, scene.bass_stretch);
    let music = RIBBON_MUSIC_GAIN * ribbon_level(scene.values, s) * (1.0 + RIBBON_MUSIC_KICK * scene.kick);
    let at = |level| RibbonAt {
        level,
        flow: scene.flow,
        time: scene.time,
        treble: scene.treble,
        swell: scene.swell,
        strand: k,
    };
    let calm = ribbon_radius(angle, &at(music.min(1.0)));
    let surge = ribbon_surge(calm, scene.kick_ages, scene.kick_powers, scene.kick_seeds, Some(theta));
    let level = (music + surge).min(1.0);
    (ribbon_radius(angle, &at(level)), level, s)
}

/// Lays letters along a path: `point(t)` gives a point (px from the dial's center, y down) at `t`,
/// `unit` px of the path per unit of t, walking in `read` (+1 or -1) direction. Each letter's center
/// is its share of the word's advances from the word's middle at t0, turned to the path's tangent.
fn lay_out(
    advances: &[f64],
    t0: f64,
    unit: f64,
    read: f64,
    point: impl Fn(f64) -> (f64, f64),
    out: &mut [PlacedLetter],
) {
    let width = advances.iter().fold(0.0, |sum, a| sum + a);
    let eps = 0.5 / unit;
    let mut before = 0.0;
    for (&advance, letter) in advances.iter().zip(out) {
        let t = t0 + read * (before + advance / 2.0 - width / 2.0) / unit;
        before += advance;
        let (p, ahead, behind) = (point(t), point(t + read * eps), point(t - read * eps));
        *letter =
            PlacedLetter { x: p.0, y: p.1, rotation: libm::atan2(ahead.1 - behind.1, ahead.0 - behind.0) * 180.0 / PI };
    }
}

/// Where a word sits on the ring this frame, from its `spot`, its letters' `advances` (px) and the
/// `scene`: each letter, into `letters` (as many as there are advances; the rest are left as they
/// are), lying along the Ribbon's curve or the Hand's wave, reading left to right and upright; and
/// the word's middle, radius, direction and color. A bar spot lands on its Ribbon `x` of the way
/// round. lyrics.mjs wordPlacement().
pub fn word_placement(spot: Spot, advances: &[f64], scene: &WordScene, letters: &mut [PlacedLetter]) -> WordPlacement {
    let d = scene.dial_radius;
    let n = advances.len().min(letters.len());
    let (advances, letters) = (&advances[..n], &mut letters[..n]);
    let color = match spot {
        Spot::Hand { hand, along } => {
            let index = if hand < 3 { hand } else { 0 };
            let pose = scene.poses[index];
            let a = pose.angle * PI / 180.0;
            let (dir, side) = ((libm::sin(a), -libm::cos(a)), (libm::cos(a), libm::sin(a)));
            let span = pose.length - pose.inner;
            let phase = scene.phases[index] + index as f64 * HAND_PHASE;
            let point = |u: f64| {
                let along = pose.inner + u * span;
                let across = wave_offset(clamp01(u), phase, pose.amplitude, scene.treble);
                ((dir.0 * along + side.0 * across) * d, (dir.1 * along + side.1 * across) * d)
            };
            // Outward on the right half, inward on the left, so it reads left to right.
            let read = if dir.0 >= -1e-9 { 1.0 } else { -1.0 };
            let width = advances.iter().fold(0.0, |sum, a| sum + a);
            let half = width / 2.0 / (span * d);
            // On the Hand, or for a word longer than it, from its inner end, reaching past the tip by
            // up to half the Hand as its spot nears the tip, so words on it still land apart.
            let u0 = if half >= 0.5 { half + 0.5 * clamp01(along) } else { (1.0 - half).min(half.max(along)) };
            lay_out(advances, u0, span * d, read, point, letters);
            bright(rgb(HAND_COLORS[index]).map(|v| libm::pow(v, 1.0 + 1.5 * SATURATION)))
        }
        Spot::Ribbon { ribbon: k, angle } | Spot::Bar { ribbon: k, x: angle } => {
            let angle = if let Spot::Bar { .. } = spot { angle * 360.0 } else { angle };
            let theta0 = ((angle % 360.0) + 360.0) % 360.0 * PI / 180.0;
            let (radius, level, s) = ribbon_at(theta0, k, scene);
            let point = |theta: f64| {
                let r = ribbon_at(theta, k, scene).0 * d;
                (r * libm::sin(theta), -r * libm::cos(theta))
            };
            // Clockwise over the top, counterclockwise along the bottom, so it reads left to right.
            let read = if libm::cos(theta0) >= 0.0 { 1.0 } else { -1.0 };
            lay_out(advances, theta0, radius * d, read, point, letters);
            let hue = RIBBON_HUE_TIME * scene.time
                + RIBBON_HUE_SPECTRUM * s
                + RIBBON_HUE_RIBBON * k as f64
                + RIBBON_HUE_ALONG * s
                + RIBBON_HUE_LEVEL * level;
            bright(pal(hue))
        }
    };
    let (mut x, mut y) = letters.get(n / 2).map_or((0.0, 0.0), |m| (m.x, m.y));
    if n > 0 && n % 2 == 0 {
        let before = letters[n / 2 - 1];
        (x, y) = ((x + before.x) / 2.0, (y + before.y) / 2.0);
    }
    let theta = libm::atan2(x, -y);
    WordPlacement { x, y, radius: libm::hypot(x, y) / d, theta: if theta < 0.0 { theta + TAU } else { theta }, color }
}

/// How a word looks on the Lock Ring this frame: its size factor (oversized as it lands, more with
/// a Kick, settling to 1; a little wider as it dissolves), its opacity (fading in over its pop-in,
/// dimmer for a background vocal, gone as it dissolves), how far it flares toward white (its
/// landing flash and the Shockwave's flare), how blurred it is (0..1, as it dissolves), and the
/// Shockwave's split and glow, as the Digital Time takes it.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RingWordLook {
    pub scale: f64,
    pub opacity: f64,
    pub white: f64,
    pub blur: f64,
    pub hit: TimeHit,
}

/// A word's look, from its pop-in, pop, dissolve and brightness and how brightly a Shockwave's front
/// is crossing it (`crossing`, 0..1: shockwave_crossing() at its radius and direction). lyrics.mjs
/// wordLook().
pub fn word_look(word: &LyricWord, crossing: f64) -> RingWordLook {
    let (pop_in, pop, dissolve) = (clamp01(word.pop_in), clamp01(word.pop), clamp01(word.dissolve));
    let landing = (1.0 - pop_in) * (1.0 - pop_in);
    let hit = time_hit(crossing);
    RingWordLook {
        scale: 1.0 + WORD_LOOK_GROW * pop * landing + WORD_LOOK_DISSOLVE_GROW * dissolve,
        opacity: clamp01(word.brightness) * (pop_in / WORD_LOOK_FADE_IN).min(1.0) * (1.0 - dissolve),
        white: (WORD_LOOK_FLASH * pop * (1.0 - pop_in) + hit.white).min(1.0),
        blur: dissolve,
        hit,
    }
}

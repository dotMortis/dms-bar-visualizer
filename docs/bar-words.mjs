// Lyric Words on the Bar Visualizer, apart from drawing: where each letter of a word sits as it
// rides its Ribbon, and how the word looks as it pops in, takes a Shockwave and dissolves. Plain JS
// for tests/bar-words.test.mjs; lyrics/LyricWordsLayer.qml draws the words from it. Which words
// show, where they land and how far their pop-in and dissolve have got is docs/lyric-words.mjs's;
// the Ribbons' shape, color and Shockwaves are docs/bar-ribbons.mjs's.
import { ribbonHeight } from "./bar-ribbons.mjs";

// The look of a word:
//   font         its letters' pixel size, as a share of the bar's thickness
//   grow         how oversized it pops in, at full pop (docs/lyric-words.mjs POP: base..1)
//   flash        how far toward white it flashes as it pops in, at full pop
//   glow         its glow in its Ribbon's color: `base` always, `pop` more as it pops in, at
//                full pop, `hit` more at a full Shockwave crossing
//   hit          a Shockwave crossing it: `white` how far it flares toward white, `grow` how
//                much it swells, `split` its
//                copies' colors (the Shockwave's own, as viz.frag's front) and how far each is
//                pushed outward, in its letters' size, at `opacity`. Like the Lock Ring's
//                Digital Time (docs/lock-ring/clock.mjs TIME_HIT).
//   dissolveGrow how much it swells as it dissolves; it blurs out too
//   space        the gap between the words of a row, in ems (its letters' size)
//   wave         how it rides its Ribbon's wave: `follow` how much of the Ribbon's rise and fall
//                (from the bar's middle) a letter follows, and its tilt with it; `reach` how far a
//                letter may stray from the bar's middle at most, as a share of the bar's thickness
export const LOOK = {
    font: 0.8,
    grow: 0.5,
    flash: 0.9,
    glow: { base: 0.85, pop: 0.6, hit: 0.9 },
    hit: { white: 0.9, grow: 0.18, split: [["#b4befe", 0.7], ["#cba6f7", 0.48], ["#89b4fa", 0.26]], opacity: 0.9 },
    dissolveGrow: 0.25,
    space: 1.2,
    wave: { follow: 0.5, reach: 0.22 },
};

// A row's widths for layWord(), in pixels, from a word's spot (docs/lyric-words.mjs: `row` and
// `before`): { width, before }. `measure(letter)` is a letter's width and `em` its size; each
// space between words is LOOK.space ems wide instead of the font's own.
export function rowWidths(spot, measure, em) {
    const width = text => Array.from(text).reduce((a, c) => a + (/\s/.test(c) ? LOOK.space * em : measure(c)), 0);
    return { width: width(spot.row), before: width(spot.before) };
}

// Pixels either side of a letter its tilt is measured over.
const SLOPE_SPAN = 1;

// Where each letter of a word at `spot` ({ ribbon, x }, docs/lyric-words.mjs on the bar) sits: [{
// x, y, angle }], its middle in pixels from the bar's top left, tilted `angle` degrees clockwise.
// `advances` are the letters' widths in pixels; the word lies across the bar from x = 0 (flush with
// its left edge) to 1 (flush with its right), each letter riding its Ribbon's wave and tilted with
// it, damped toward the bar's middle (LOOK.wave). `inputs` are docs/bar-ribbons.mjs
// ribbonHeight()'s, and `clearance`, how far (pixels) a letter's middle stays from the bar's top
// and bottom edges: on a crest that leaves the bar, or past LOOK.wave.reach, a letter stops there,
// upright. `row`, for a word in a row (the spot's `row` and `before`), is { width, before }: the
// row's width and that of its text before the word, in pixels. Then the whole row lies across the
// bar from x = 0 to 1 instead, and the word sits in it; a row wider than the bar starts at its left
// edge.
export function layWord(spot, advances, inputs, row) {
    const total = advances.reduce((a, b) => a + b, 0);
    const clearance = inputs.clearance || 0;
    const height = inputs.height;
    const width = row ? row.width : total;
    let left = Math.max(0, inputs.width - width) * Math.min(1, Math.max(0, spot.x)) + (row ? row.before : 0);
    // The Ribbon's height at `at`, damped toward the bar's middle.
    const along = at => height / 2 + LOOK.wave.follow * (ribbonHeight(at, spot.ribbon, inputs) * height - height / 2);
    const lo = Math.max(Math.min(clearance, height / 2), height / 2 - LOOK.wave.reach * height), hi = height - lo;
    return advances.map(advance => {
        const x = left + advance / 2;
        left += advance;
        const y = along(x);
        if (y < lo || y > hi)
            return { x, y: y < lo ? lo : hi, angle: 0 };
        const rise = along(x + SLOPE_SPAN) - along(x - SLOPE_SPAN);
        return { x, y, angle: Math.atan2(rise, 2 * SLOPE_SPAN) * 180 / Math.PI };
    });
}

// How a word (docs/lyric-words.mjs words()' entry: size, brightness, popIn, pop, dissolve) looks
// with a Shockwave `crossing` it (docs/bar-ribbons.mjs shockwaveCrossing(), 0..1):
//   scale    its size (1 = a settled lead vocal's)
//   opacity  0..1
//   white    how far toward white it is, 0..1: its pop-in flash or a Shockwave's flare
//   glow     how bright its glow is in its Ribbon's color
//   blur     how blurred, 0..1, as it dissolves
//   copies   its split: [{ color, offset (in its letters' size, outward), opacity }]
export function wordLook(word, crossing) {
    const hit = Number.isFinite(crossing) ? Math.min(1, Math.max(0, crossing)) : 0;
    const popping = 1 - Math.min(1, Math.max(0, word.popIn));
    const dissolve = Math.min(1, Math.max(0, word.dissolve));
    const opacity = word.brightness * Math.min(1, word.popIn * 4) * (1 - dissolve);
    return {
        scale: word.size * (1 + LOOK.grow * word.pop * popping * popping) * (1 + LOOK.hit.grow * hit) * (1 + LOOK.dissolveGrow * dissolve),
        opacity,
        white: Math.max(LOOK.flash * word.pop * popping, LOOK.hit.white * hit),
        glow: LOOK.glow.base + LOOK.glow.pop * word.pop * popping + LOOK.glow.hit * hit,
        blur: dissolve,
        copies: LOOK.hit.split.map(([color, offset]) => ({ color, offset: offset * hit, opacity: LOOK.hit.opacity * hit * opacity })),
    };
}

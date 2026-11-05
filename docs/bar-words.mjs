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
export const LOOK = {
    font: 0.8,
    grow: 0.5,
    flash: 0.9,
    glow: { base: 0.85, pop: 0.6, hit: 0.9 },
    hit: { white: 0.9, grow: 0.18, split: [["#b4befe", 0.7], ["#cba6f7", 0.48], ["#89b4fa", 0.26]], opacity: 0.9 },
    dissolveGrow: 0.25,
};

// Pixels either side of a letter its tilt is measured over.
const SLOPE_SPAN = 1;

// Where each letter of a word at `spot` ({ ribbon, x }, docs/lyric-words.mjs on the bar) sits:
// [{ x, y, angle }], its middle in pixels from the bar's top left, tilted `angle` degrees
// clockwise. `advances` are the letters' widths in pixels; the word lies across the bar from
// x = 0 (flush with its left edge) to 1 (flush with its right), each letter on its Ribbon and
// tilted with it. `inputs` are docs/bar-ribbons.mjs ribbonHeight()'s, and `clearance`, how far
// (pixels) a letter's middle stays from the bar's top and bottom edges: on a crest that leaves the
// bar, a letter stops at the edge, upright.
export function layWord(spot, advances, inputs) {
    const total = advances.reduce((a, b) => a + b, 0);
    const clearance = inputs.clearance || 0;
    const height = inputs.height;
    let left = Math.max(0, inputs.width - total) * Math.min(1, Math.max(0, spot.x));
    return advances.map(advance => {
        const x = left + advance / 2;
        left += advance;
        const y = ribbonHeight(x, spot.ribbon, inputs) * height;
        const lo = Math.min(clearance, height / 2), hi = height - lo;
        if (y < lo || y > hi)
            return { x, y: y < lo ? lo : hi, angle: 0 };
        const rise = (ribbonHeight(x + SLOPE_SPAN, spot.ribbon, inputs) - ribbonHeight(x - SLOPE_SPAN, spot.ribbon, inputs)) * height;
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

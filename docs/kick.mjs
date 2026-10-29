// Kick detection, shared by the visualizer (shell.qml) and the demo (index.html) so they can't drift.
// Plain ECMAScript that QML, browsers and node all load. In docs/, as GitHub Pages serves only that.

// cava's layout, which shell.qml configures it with: 32 bands from 30 Hz to 14 kHz, bass first.
export const BANDS = 32;
export const LOW_HZ = 30;
export const HIGH_HZ = 14000;
const RATE = 44100;  // the sample rate of cava's pulse input

// Smoothing is per second and applied with the frames' timestamps, so it is the same at any frame rate.
// How much of each band's running average is left after a second: 0.92 per frame at 60 fps.
const AVERAGE_KEEP = 0.92 ** 60;

// Rises are measured against the kick range's recent peak, as cava's autosens keeps rescaling.
// How much of the peak is left after a second: it halves in 1.15 s (0.99 per frame at 60 fps).
const PEAK_KEEP = 0.99 ** 60;
// The peak's floor on cava's scale, so a near-silent range can't fire kicks on noise.
const PEAK_FLOOR = 0.05;
// A band below this fraction of the peak is too quiet to fire a kick.
const QUIET = 0.15;

// One kick per hit: a hit has ended once the range's level has stayed under half its top for this
// many seconds. A short dip isn't the end: a ringing kick beats against a bass note, 808 tails cancel.
const SETTLE = 0.2;
// A new hit can come in above the band the last one rings in, in bands it has left: fallen to this
// fraction of their top. Not half: a 16th note before the beat leaves them at 0.5-0.55.
const FALLEN_TO = 0.6;

// Where cava 1.0 puts its bands (cava_init in cavacore.c): band n adds up the FFT bins first..last
// of an FFT of `size` samples and scales the sum by `gain`.
const LAYOUT = cavaLayout();

function cavaLayout() {
    const fft = 4096;  // cava's FFT size at 44.1 kHz; bands below 100 Hz use one twice as long
    const edges = [];
    for (let n = 0; n <= BANDS; n++) {
        const prev = edges[n - 1];
        // BANDS + 1 cutoffs, evenly spaced on a log scale. One that crowds into the cutoff below
        // moves up past it by about a bass bin.
        let hz = LOW_HZ * Math.pow(HIGH_HZ / LOW_HZ, n / BANDS);
        if (prev && prev.hz >= hz)
            hz = prev.hz + Math.floor(RATE / (2 * fft));
        // Each cutoff moves to an FFT bin, and a band below it gets at least one bin.
        const size = hz < 100 ? 2 * fft : fft;
        let bin = size > fft ? Math.floor(hz * size / RATE) : Math.ceil(hz * size / RATE);
        let last;  // of the band below this cutoff
        if (prev && prev.size === size) {
            bin = Math.max(bin, prev.bin + 1);
            last = bin - 1;
        } else if (prev) {
            // The last bass band ends at this cutoff, in the bass FFT's bins.
            last = Math.floor(hz * prev.size / RATE) - 1;
            if (last < prev.bin)
                last = prev.bin + 1;
        }
        edges.push({ size, bin, last, hz: bin * RATE / size });
    }
    return edges.slice(0, BANDS).map(({ size, bin: first }, n) => {
        const { last, hz: cutoff } = edges[n + 1];
        // cava's EQ: it divides by log2(size), boosts higher bands by their upper cutoff^0.85 and
        // averages over the band's bins. A sine's peak in an FFT also grows with the FFT's size.
        const eq = Math.pow(cutoff, 0.85) / Math.log2(size) / (last - first + 1);
        return { size, first, last, gain: eq * size };
    });
}

// A sine's magnitude in an FFT bin d bins from its frequency, through cava's Hann window, relative
// to its magnitude in a bin right on it.
function hann(d) {
    const sinc = x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return Math.abs(sinc(d) + (sinc(d - 1) + sinc(d + 1)) / 2);
}

// The band cava shows a sine of this frequency in most, after its window and EQ. Not always the one
// whose bins hold it: 40 Hz falls in band 1's two bins, but band 2's single bin shows it louder.
export function bandAt(hz) {
    hz = Math.max(LOW_HZ, Math.min(HIGH_HZ, hz));
    let best = 0, loudest = 0;
    LAYOUT.forEach(({ size, first, last, gain }, n) => {
        let sum = 0;
        for (let bin = first; bin <= last; bin++)
            sum += hann(hz * size / RATE - bin);
        if (sum * gain > loudest) {
            loudest = sum * gain;
            best = n;
        }
    });
    return best;
}

// A detector for config.json's kickThreshold, kickLowHz, kickHighHz and kickCooldown, and speed (1 if
// left out), which scales kickCooldown. push(values, time) every frame, at any frame rate: the 32 bands
// in 0..1 and when they came, in real seconds (the wall clock in the visualizer, the page clock in the
// demo; a step back counts as none). It returns { power } (0.5..1, by how hard the hit is next to the
// recent kicks) when a kick fires, otherwise null.
export function createKickDetector(settings) {
    const slow = new Array(BANDS).fill(0);  // each band's running average
    const previous = new Array(BANDS).fill(0);  // the last frame's values, shown until this one
    const rises = new Array(BANDS).fill(0);  // this frame's rise of each band above its average
    let threshold, cooldown, speed, from, to;  // from the settings, see configure()
    let lastFrame = null;  // the last frame's time
    let clock = 0;  // real seconds of frames so far, with a step back counted as none
    let animation = 0;  // the animation clock kickCooldown runs on: real seconds times speed
    let lastKick = -Infinity;  // on the animation clock
    let peak = PEAK_FLOOR;  // the kick range's recent peak level, slowly released
    let hit = null;  // the hit the last kick fired for, until it has ended

    // A kick's hit, from the frame it fires on.
    function startHit(values, level, band) {
        return {
            top: level,  // the kick range's highest level during the hit
            quietSince: null,  // when the level went under half of top, while it stays there
            front: band,  // the lowest band the hit has run down to
            bandTop: Array.from(values),  // each band's highest value during the hit
            fallen: new Array(BANDS).fill(false),  // the bands that have fallen to FALLEN_TO of it...
            low: new Array(BANDS).fill(0),  // ...and their lowest value since
        };
    }

    // Whether the hit has ended: the range's level has stayed under half its top for SETTLE seconds.
    function hitEnded(level) {
        hit.top = Math.max(hit.top, level);
        if (level >= hit.top / 2)
            hit.quietSince = null;
        else if (hit.quietSince === null)
            hit.quietSince = clock;
        return hit.quietSince !== null && clock - hit.quietSince >= SETTLE;
    }

    // The largest rise of a new hit while the last one rings, and its band: one the last hit has left,
    // above where it rings (a bass note beating against it, or its tail, rises at or below that).
    function newHit(values, scale, rise, band) {
        // The hit runs down to the band rising most, if by more than a hint.
        if (rise > QUIET * scale)
            hit.front = Math.min(hit.front, band);
        let onset = 0, at = band;
        for (let i = from; i < to; i++) {
            hit.bandTop[i] = Math.max(hit.bandTop[i], values[i]);
            if (i <= hit.front)
                continue;
            if (!hit.fallen[i] && values[i] < FALLEN_TO * hit.bandTop[i]) {
                hit.fallen[i] = true;
                hit.low[i] = values[i];
            }
            if (!hit.fallen[i])
                continue;
            hit.low[i] = Math.min(hit.low[i], values[i]);
            // At least QUIET at any kickThreshold: a rebound of the ringing kick is less.
            const bandRise = Math.min(rises[i], values[i] - hit.low[i]);
            if (bandRise > onset && bandRise > QUIET * scale) {
                onset = bandRise;
                at = i;
            }
        }
        return { onset, at };
    }

    const detector = {
        // The kick range: bands from..to-1.
        get bands() {
            return { from, to };
        },

        // New settings take effect on the next frame; the running state carries over.
        configure(next) {
            threshold = next.kickThreshold;
            cooldown = next.kickCooldown;
            speed = next.speed ?? 1;
            from = bandAt(next.kickLowHz);
            to = Math.max(from, bandAt(next.kickHighHz)) + 1;
        },

        push(values, time) {
            // The averages and the peak take in the last frame for as long as it was shown, so a
            // frame repeated at a higher frame rate weighs the same as at 60 fps.
            const dt = lastFrame === null ? 0 : Math.max(0, time - lastFrame);
            lastFrame = time;
            clock += dt;
            animation += dt * speed;
            const keep = AVERAGE_KEEP ** dt;
            let level = 0, previousLevel = 0;  // the kick range's level, this frame and the last
            for (let i = from; i < to; i++) {
                level = Math.max(level, values[i]);
                previousLevel = Math.max(previousLevel, previous[i]);
            }
            peak = Math.max(previousLevel, peak * PEAK_KEEP ** dt, PEAK_FLOOR);
            // Rises are measured against the peak, or this frame's level if it goes higher.
            const scale = Math.max(peak, level);
            // Each band in the kick range on its own, so a wide range still catches a note in one band.
            let rise = 0, band = from, repeat = true;  // the largest rise, and the band it is in
            let rising = 0, risingBand = from;  // the same, of the bands that went up on this frame
            for (let i = 0; i < BANDS; i++) {
                slow[i] = slow[i] * keep + previous[i] * (1 - keep);
                repeat = repeat && values[i] === previous[i];
                const up = values[i] > previous[i];
                previous[i] = values[i];
                rises[i] = i >= from && i < to && values[i] > QUIET * scale ? values[i] - slow[i] : 0;
                if (rises[i] > rise) {
                    rise = rises[i];
                    band = i;
                }
                if (up && rises[i] > rising) {
                    rising = rises[i];
                    risingBand = i;
                }
            }
            // The same frame pushed again was measured when it came.
            if (repeat)
                return null;
            if (hit && hitEnded(level))
                hit = null;
            // Once the last hit has ended, any band going up can fire. One on its way down is the
            // tail of something earlier.
            const { onset, at } = hit ? newHit(values, scale, rise, band) : { onset: rising, at: risingBand };
            if (onset / scale > threshold && animation - lastKick >= cooldown) {
                lastKick = animation;
                hit = startHit(values, level, at);
                // From 0.5 to 1 for a rise as big as the peak before this hit, so accents stand out.
                return { power: 0.5 + 0.5 * Math.min(1, onset / peak) };
            }
            return null;
        },
    };
    detector.configure(settings);
    return detector;
}

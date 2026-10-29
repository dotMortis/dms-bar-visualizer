// Kick detection, shared by the visualizer (shell.qml) and the demo (index.html) so the two can't
// drift. A plain ECMAScript module with no Quickshell or browser dependencies: QML imports it as a
// JavaScript module, the demo as a module script, and node loads it as is.
// It lives in docs/ because GitHub Pages publishes only this directory.

// cava's layout: 32 bands from 30 Hz to 14 kHz, bass first. shell.qml configures cava with these;
// its pulse input samples at 44.1 kHz.
export const BANDS = 32;
export const LOW_HZ = 30;
export const HIGH_HZ = 14000;
const RATE = 44100;

// Smoothing is defined per second and applied with the frames' timestamps, so the detector does
// the same at cava's 60 frames per second (the visualizer) as at any display refresh rate (the demo).
// How much of each band's running average is left after a second: 0.92 per frame at 60 fps.
const AVERAGE_KEEP = 0.92 ** 60;

// Jumps are measured against the kick range's recent peak level, not on cava's 0..1 scale: cava's
// autosens keeps rescaling its output, so the same kick comes out louder or quieter.
// How much of the peak is left after a second once the music gets quieter: it halves in about
// 1.15 s (0.99 per frame at 60 fps), so kicks come back soon after a drop in volume.
const PEAK_KEEP = 0.99 ** 60;
// The peak never falls below this level on cava's scale, so a near-silent range can't fire kicks
// on noise.
const PEAK_FLOOR = 0.05;
// A band below this fraction of the peak is too quiet to fire a kick.
const QUIET = 0.15;

// One kick per hit. After a kick the detector waits for the hit to end: the kick range's level has to
// stay under half the highest level it reached during the hit for this many seconds (real time). A
// dip of a frame or three isn't the end of a hit: a kick ringing over a bass note beats against it,
// and two 808 tails cancel each other out for a moment, before coming back up. From 0.17 to 0.25 s,
// the replays fire the same kicks; at 0.15 s, one hit fires twice at kickThreshold 0.15.
const SETTLE = 0.2;
// A new hit can also come before the last one has ended, as with a 16th note before the beat. A
// kick's pitch falls as it rings, so a hit runs down through the bands, and the last one rings in the
// band it got down to. A new hit comes in above that band, in bands the last hit has left: ones that
// have fallen to this fraction of the highest value they reached during it. Not half: a 16th note
// 121 ms before the beat is still running down when the beat's kick comes in, and the bands between
// fall to only 0.5-0.55 of their top: at half, 3 of the replays' 10 such pairs fire as one kick.
// From 0.55 to 0.8, the replays score the same; at 0.85, one hit fires twice.
const LEFT = 0.6;

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

// The band cava shows a sine of this frequency in most: the one that sums the most of it, after the
// window spreads it over neighbouring bins and the EQ scales each band. That isn't always the band
// whose bins contain the frequency: 40 Hz falls in band 1's two bins, but band 2's single bin
// gets twice the gain and shows it louder.
function bandAt(hz) {
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

// A detector for the kick settings of config.json: kickThreshold, kickLowHz, kickHighHz and
// kickCooldown, plus speed (1 if left out), which scales kickCooldown like the rest of the
// animation. Feed it every frame with push(values, time), at any frame rate: values are the 32 bands
// in 0..1, time is when the frame came, in real seconds (the wall clock when cava's line arrives in
// the visualizer, the page clock in the demo). A clock stepping back counts as no time passing.
// push returns { power } (0.5..1, by how hard the hit is next to the recent kicks) when a kick
// fires, otherwise null.
export function createKickDetector(settings) {
    const slow = new Array(BANDS).fill(0);  // per-band running average for onsets
    const shown = new Array(BANDS).fill(0);  // the previous frame's values, shown until this one
    let threshold, cooldown, speed, from, to;  // from the settings, see configure()
    let lastFrame = null;  // the previous frame's time
    let clock = 0;  // real seconds since the first frame, on which the detector measures time
    let animation = 0;  // the animation clock kickCooldown runs on: real seconds times speed
    let lastKick = -Infinity;  // on the animation clock
    let peak = PEAK_FLOOR;  // the kick range's recent peak level, slowly released
    const rises = new Array(BANDS).fill(0);  // this frame's rise of each band above its average
    // The hit the last kick fired for, until it has ended (see SETTLE and LEFT):
    let armed = true;  // whether it has ended
    let hitTop = 0;  // the kick range's highest level during the hit
    let fallenSince = null;  // when the level fell under half of hitTop, while it stays there
    let front = 0;  // the lowest band the hit has run down to
    const top = new Array(BANDS).fill(0);  // each band's highest value during the hit
    const left = new Array(BANDS).fill(false);  // the bands the hit has left...
    const low = new Array(BANDS).fill(0);  // ...and their lowest value since

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
            // The averages take in the previous frame's values for as long as they were shown, so a
            // frame repeated at a higher frame rate weighs the same as at 60 fps. A clock stepping
            // back counts as no time passing.
            const dt = lastFrame === null ? 0 : Math.max(0, time - lastFrame);
            lastFrame = time;
            clock += dt;
            animation += dt * speed;
            const keep = AVERAGE_KEEP ** dt;
            // The kick range's peak level until this frame. Like the averages, it takes in the
            // previous frame for as long as it was shown, at its full level: it only releases once
            // the level falls.
            let level = 0, shownLevel = 0;
            for (let i = from; i < to; i++) {
                level = Math.max(level, values[i]);
                shownLevel = Math.max(shownLevel, shown[i]);
            }
            peak = Math.max(shownLevel, peak * PEAK_KEEP ** dt, PEAK_FLOOR);
            // The level jumps are measured against: the peak, or this frame if it goes higher.
            const scale = Math.max(peak, level);
            // Kick = any band in the kick range jumping well above its own recent average, by
            // kickThreshold times that level. Per band, not averaged over the range, so a wide range
            // still catches a note that hits one band. Bands far below the peak don't count.
            let rise = 0, band = from, repeat = true;  // the largest rise, and the band it is in
            let rising = 0, risingBand = from;  // the same, of the bands that went up on this frame
            for (let i = 0; i < BANDS; i++) {
                slow[i] = slow[i] * keep + shown[i] * (1 - keep);
                repeat = repeat && values[i] === shown[i];
                const up = values[i] > shown[i];
                shown[i] = values[i];
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
            // The same frame pushed again (a display refreshing faster than the frames come) only
            // counts towards the averages and the peak: it was measured when it came.
            if (repeat)
                return null;
            // One kick per hit. The last hit has ended once the range's level has stayed under half
            // its top for SETTLE seconds. On the frames' clock, so the same at any frame rate.
            if (!armed) {
                hitTop = Math.max(hitTop, level);
                if (level >= hitTop / 2)
                    fallenSince = null;
                else if (fallenSince === null)
                    fallenSince = clock;
                armed = fallenSince !== null && clock - fallenSince >= SETTLE;
            }
            // The rise that can fire a kick, and the band it is in: once the last hit has ended, that
            // of any band going up (one still above its average on the way down is the tail of
            // something earlier). Until then, only a band that hit has left, above the band it has run down to (the
            // band rising most, if that is more than a hint of a rise). There, a new hit has to rise
            // above the band's average and above its lowest since the hit left it, by at least QUIET of
            // the level at any kickThreshold. A bass note beating against the ringing kick, or the
            // kick's tail moving into a lower band, rises at or below that band, or by less.
            let onset = armed ? rising : 0, at = armed ? risingBand : band;
            if (!armed) {
                if (rise > QUIET * scale)
                    front = Math.min(front, band);
                for (let i = from; i < to; i++) {
                    top[i] = Math.max(top[i], values[i]);
                    if (i <= front)
                        continue;
                    if (!left[i] && values[i] < LEFT * top[i]) {
                        left[i] = true;
                        low[i] = values[i];
                    }
                    if (left[i]) {
                        low[i] = Math.min(low[i], values[i]);
                        const own = Math.min(rises[i], values[i] - low[i]);
                        if (own > onset && own > QUIET * scale) {
                            onset = own;
                            at = i;
                        }
                    }
                }
            }
            if (onset / scale > threshold && animation - lastKick >= cooldown) {
                armed = false;
                lastKick = animation;
                hitTop = level;
                fallenSince = null;
                front = at;
                for (let i = 0; i < BANDS; i++) {
                    top[i] = values[i];
                    left[i] = false;
                }
                // Power grows with the rise that fired, against the peak before this hit, from 0.5
                // to 1 for a rise as big as that peak: a hit that rises above the recent kicks gets
                // full power, so accents stand out at any volume.
                return { power: 0.5 + 0.5 * Math.min(1, onset / peak) };
            }
            return null;
        },
    };
    detector.configure(settings);
    return detector;
}

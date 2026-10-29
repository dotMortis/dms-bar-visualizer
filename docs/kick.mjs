// Kick detection, shared by the visualizer (shell.qml) and the demo (index.html) so the two can't
// drift. A plain ECMAScript module with no Quickshell or browser dependencies: QML imports it as a
// JavaScript module, the demo as a module script, and node loads it as is.
// It lives in docs/ because GitHub Pages publishes only this directory.

// cava's bands, as configured in shell.qml: 32 bands from 30 Hz to 14 kHz, bass first. Its pulse
// input samples at 44.1 kHz.
const BANDS = 32;
const LOW_HZ = 30;
const HIGH_HZ = 14000;
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
// in 0..1, time is when the frame came, in real seconds (cava's frame time in the visualizer, the
// page clock in the demo). push returns { power } (0.5..1, by how hard the hit is next to the
// recent kicks) when a kick fires, otherwise null.
export function createKickDetector(settings) {
    const slow = new Array(BANDS).fill(0);  // per-band running average for onsets
    const shown = new Array(BANDS).fill(0);  // the previous frame's values, shown until this one
    let threshold, cooldown, speed, from, to;  // from the settings, see configure()
    let lastFrame = null;  // the previous frame's time
    let animation = 0;  // the animation clock kickCooldown runs on: real seconds times speed
    let lastKick = -Infinity;  // on the animation clock
    let armed = true;
    let peak = PEAK_FLOOR;  // the kick range's recent peak level, slowly released

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
            let rise = 0, repeat = true;
            for (let i = 0; i < BANDS; i++) {
                slow[i] = slow[i] * keep + shown[i] * (1 - keep);
                repeat = repeat && values[i] === shown[i];
                shown[i] = values[i];
                if (i >= from && i < to && values[i] > QUIET * scale)
                    rise = Math.max(rise, values[i] - slow[i]);
            }
            // The same frame pushed again (a display refreshing faster than the frames come) only
            // counts towards the averages and the peak: it was measured when it came. Measured again
            // as the averages catch up, its jump shrinks, which re-armed on frames 60 fps never shows.
            if (repeat)
                return null;
            const jump = rise / scale;
            // One kick per hit: re-arm only once the whole range has settled. A kick's pitch drops as
            // it rings, so its energy reaches lower bands a window later and reads as a fresh onset.
            if (jump < threshold * 0.5)
                armed = true;
            if (armed && jump > threshold && animation - lastKick >= cooldown) {
                armed = false;
                lastKick = animation;
                // Power grows with the jump against the peak before this hit, from 0.5 to 1 for a
                // jump as big as that peak: a hit that rises above the recent kicks gets full power,
                // so accents stand out at any volume.
                return { power: 0.5 + 0.5 * Math.min(1, rise / peak) };
            }
            return null;
        },
    };
    detector.configure(settings);
    return detector;
}

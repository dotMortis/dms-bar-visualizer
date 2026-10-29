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

// A detector for the kick settings of config.json (kickThreshold, kickLowHz, kickHighHz,
// kickCooldown). Feed it every cava frame with push(values, time): values are the 32 bands in 0..1,
// time is in seconds on the animation clock, so kickCooldown scales with speed. push returns
// { power } (0.5..1, by how hard the hit is) when a kick fires, otherwise null.
export function createKickDetector(settings) {
    const slow = new Array(BANDS).fill(0);  // per-band running average for onsets
    let threshold, cooldown, from, to;  // from the settings, see configure()
    let lastKick = -100;
    let armed = true;

    const detector = {
        // The kick range: bands from..to-1.
        get bands() {
            return { from, to };
        },

        // New settings take effect on the next frame; the running state carries over.
        configure(next) {
            threshold = next.kickThreshold;
            cooldown = next.kickCooldown;
            from = bandAt(next.kickLowHz);
            to = Math.max(from, bandAt(next.kickHighHz)) + 1;
        },

        push(values, time) {
            // Kick = any band in the kick range jumping well above its own recent average. Per band,
            // not averaged over the range, so a wide range still catches a note that hits one band.
            let jump = 0;
            for (let i = 0; i < BANDS; i++) {
                if (i >= from && i < to && values[i] > 0.15)
                    jump = Math.max(jump, values[i] - slow[i]);
                slow[i] = slow[i] * 0.92 + values[i] * 0.08;
            }
            // One kick per hit: re-arm only once the whole range has settled. A kick's pitch drops as
            // it rings, so its energy reaches lower bands a window later and reads as a fresh onset.
            if (jump < threshold * 0.5)
                armed = true;
            if (armed && jump > threshold && time - lastKick >= cooldown) {
                armed = false;
                lastKick = time;
                return { power: Math.min(1, 0.5 + jump * 2) };
            }
            return null;
        },
    };
    detector.configure(settings);
    return detector;
}

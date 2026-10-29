// Kick detection, shared by the visualizer (shell.qml) and the demo (index.html) so the two can't
// drift. A plain ECMAScript module with no Quickshell or browser dependencies: QML imports it as a
// JavaScript module, the demo as a module script, and node loads it as is.
// It lives in docs/ because GitHub Pages publishes only this directory.

// cava's bands, as configured in shell.qml: 32 log-spaced bands from 30 Hz to 14 kHz, bass first.
const BANDS = 32;
const LOW_HZ = 30;
const HIGH_HZ = 14000;

// Nearest band edge for a frequency.
function bandAt(hz) {
    return Math.round(Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ) * BANDS);
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
            from = Math.max(0, Math.min(BANDS - 1, bandAt(next.kickLowHz)));
            to = Math.max(from + 1, Math.min(BANDS, bandAt(next.kickHighHz)));
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

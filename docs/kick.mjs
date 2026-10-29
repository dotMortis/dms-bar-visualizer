// Kick detection, shared by the visualizer (shell.qml) and the demo (index.html) so the two can't
// drift. A plain ECMAScript module with no Quickshell or browser dependencies: QML imports it as a
// JavaScript module, the demo as a module script, and node loads it as is.
// It lives in docs/ because GitHub Pages publishes only this directory.

// cava's bands, as configured in shell.qml: 32 log-spaced bands from 30 Hz to 14 kHz, bass first.
const BANDS = 32;
const LOW_HZ = 30;
const HIGH_HZ = 14000;

// Smoothing is defined per second and applied with the frames' timestamps, so the detector does
// the same at cava's 60 frames per second (the visualizer) as at any display refresh rate (the demo).
// How much of each band's running average is left after a second: 0.92 per frame at 60 fps.
const AVERAGE_KEEP = 0.92 ** 60;

// Nearest band edge for a frequency.
function bandAt(hz) {
    return Math.round(Math.log(hz / LOW_HZ) / Math.log(HIGH_HZ / LOW_HZ) * BANDS);
}

// A detector for the kick settings of config.json: kickThreshold, kickLowHz, kickHighHz and
// kickCooldown, plus speed (1 if left out), which scales kickCooldown like the rest of the
// animation. Feed it every frame with push(values, time), at any frame rate: values are the 32 bands
// in 0..1, time is when the frame came, in real seconds (cava's frame time in the visualizer, the
// page clock in the demo). push returns { power } (0.5..1, by how hard the hit is) when a kick
// fires, otherwise null.
export function createKickDetector(settings) {
    const slow = new Array(BANDS).fill(0);  // per-band running average for onsets
    const shown = new Array(BANDS).fill(0);  // the previous frame's values, shown until this one
    let threshold, cooldown, speed, from, to;  // from the settings, see configure()
    let lastFrame = null;  // the previous frame's time
    let animation = 0;  // the animation clock kickCooldown runs on: real seconds times speed
    let lastKick = -Infinity;  // on the animation clock
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
            speed = next.speed ?? 1;
            from = Math.max(0, Math.min(BANDS - 1, bandAt(next.kickLowHz)));
            to = Math.max(from + 1, Math.min(BANDS, bandAt(next.kickHighHz)));
        },

        push(values, time) {
            // The averages take in the previous frame's values for as long as they were shown, so a
            // frame repeated at a higher frame rate weighs the same as at 60 fps. A clock stepping
            // back counts as no time passing.
            const dt = lastFrame === null ? 0 : Math.max(0, time - lastFrame);
            lastFrame = time;
            animation += dt * speed;
            const keep = AVERAGE_KEEP ** dt;
            // Kick = any band in the kick range jumping well above its own recent average. Per band,
            // not averaged over the range, so a wide range still catches a note that hits one band.
            let jump = 0;
            for (let i = 0; i < BANDS; i++) {
                slow[i] = slow[i] * keep + shown[i] * (1 - keep);
                shown[i] = values[i];
                if (i >= from && i < to && values[i] > 0.15)
                    jump = Math.max(jump, values[i] - slow[i]);
            }
            // One kick per hit: re-arm only once the whole range has settled. A kick's pitch drops as
            // it rings, so its energy reaches lower bands a window later and reads as a fresh onset.
            if (jump < threshold * 0.5)
                armed = true;
            if (armed && jump > threshold && animation - lastKick >= cooldown) {
                armed = false;
                lastKick = animation;
                return { power: Math.min(1, 0.5 + jump * 2) };
            }
            return null;
        },
    };
    detector.configure(settings);
    return detector;
}

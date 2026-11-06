// The harness's frame timing and GPU frame time, from Qt's render-loop log in qs.log
// (QSG_RENDER_TIMING=1 QSG_RHI_PROFILE=1, `qs --log-times`).
//
//   node harness/frames.mjs <qs.log> <start> <end> [--monitors <hyprctl -j monitors>] [--json FILE]
//   start and end are the window, in wall-clock s since the epoch

// A render thread's line: its time, its window and what it says.
const LINE = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)\.(\d{3}) .*\[window (\w+)\]\[render thread [^\]]*\] syncAndRender: (.*)/;
const GPU_TIME = /^last retrieved GPU frame time was ([\d.]+) ms/;

// A longer pause between two frames is the scene at rest (nothing animates, so Qt renders nothing),
// not a late frame: a quarter second is 15 refreshes at 60 Hz.
const IDLE_MS = 250;

// The frames each window's render loop rendered in [start, end) (s since the epoch).
export function frameTiming(log, { start, end, refreshMs }) {
    const windows = new Map(), gpuMs = [];
    for (const line of log.split("\n")) {
        const m = line.match(LINE);
        if (!m) continue;
        const [, y, mo, d, h, mi, s, ms, win, what] = m;
        const t = new Date(+y, mo - 1, +d, +h, +mi, +s, +ms).getTime() / 1000;
        if (t < start || t >= end) continue;
        if (what.startsWith("frame rendered")) {
            if (!windows.has(win)) windows.set(win, []);
            windows.get(win).push(t);
        } else {
            const g = what.match(GPU_TIME);
            if (g) gpuMs.push(Number(g[1]));
        }
    }
    let frames = 0, late = 0, missed = 0, worst = 0, idle = 0, idleS = 0;
    for (const times of windows.values()) {
        frames += times.length;
        for (let i = 1; i < times.length; i++) {
            const gap = (times[i] - times[i - 1]) * 1000;
            if (gap > IDLE_MS) {
                idle++;
                idleS += gap / 1000;
                continue;
            }
            worst = Math.max(worst, gap);
            if (gap > 1.5 * refreshMs) {
                late++;
                missed += Math.round(gap / refreshMs) - 1;
            }
        }
    }
    const fps = windows.size ? frames / windows.size / (end - start) : 0;
    return { frames, windows: windows.size, fps, late, missed, worstMs: Math.round(worst), idle, idleS, gpu: stats(gpuMs) };
}

// The display's refresh rate from `hyprctl -j monitors`. qs's log doesn't say which window is on
// which monitor, so with several rates the slowest: no frame on time on its own monitor counts late.
export function displayRefresh(monitors) {
    const rates = monitors.filter(m => !m.disabled && m.refreshRate > 0).map(m => m.refreshRate);
    return rates.length ? { hz: Math.min(...rates), monitors: rates.length } : null;
}

// Mean, 95th percentile (nearest rank) and worst of a list of ms.
function stats(ms) {
    const sorted = [...ms].sort((a, b) => a - b);
    const at = q => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
    return {
        frames: ms.length,
        meanMs: ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length : null,
        p95Ms: ms.length ? at(0.95) : null,
        maxMs: ms.length ? sorted.at(-1) : null,
    };
}

const fixed = (x, d) => (x === null ? null : Number(x.toFixed(d)));

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const args = process.argv.slice(2);
    const option = name => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : null);
    const monitors = option("--monitors"), json = option("--json");
    const [log, start, end] = args;
    const display = monitors ? displayRefresh(JSON.parse(fs.readFileSync(monitors, "utf8"))) : null;
    const hz = display?.hz ?? 60;
    const refreshMs = 1000 / hz;
    const t = frameTiming(fs.readFileSync(log, "utf8"), { start: Number(start), end: Number(end), refreshMs });
    const on = display ? `on a ${hz} Hz display${display.monitors > 1 ? ` (the slowest of ${display.monitors})` : ""}` : "on a display assumed 60 Hz";
    console.log(`frames   ${t.frames} in ${(end - start).toFixed(2)} s, ${t.fps.toFixed(1)} fps per window (${t.windows}) ${on}: ${t.late} late, ${t.missed} refreshes missed, worst ${t.worstMs} ms apart`);
    console.log(`         late: over 1.5 refreshes (${(1.5 * refreshMs).toFixed(1)} ms) after the last frame; at rest (pauses over ${IDLE_MS} ms): ${t.idle}, ${t.idleS.toFixed(1)} s`);
    const g = t.gpu;
    console.log(g.frames
        ? `gpu      frame time (Qt's timestamp queries) mean ${g.meanMs.toFixed(3)} ms, p95 ${g.p95Ms.toFixed(3)}, max ${g.maxMs.toFixed(3)}, over ${g.frames} frames`
        : "gpu      no GPU frame times in qs.log (QSG_RHI_PROFILE)");
    if (json)
        fs.writeFileSync(json, JSON.stringify({
            refresh_hz: hz, frames: t.frames, frames_windows: t.windows, frames_fps: fixed(t.fps, 2), frames_late: t.late,
            frames_missed: t.missed, frames_worst_ms: t.worstMs, frames_idle: t.idle, frames_idle_s: fixed(t.idleS, 2),
            gpu_frame_ms_mean: fixed(g.meanMs, 4), gpu_frame_ms_p95: fixed(g.p95Ms, 4), gpu_frame_ms_max: fixed(g.maxMs, 4),
        }));
}

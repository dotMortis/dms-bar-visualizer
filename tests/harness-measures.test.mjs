// The replay harness's deeper measures (harness/): what they make of Qt's render-loop log, the DRM
// driver's fdinfo and perf's report. Only the parsing runs here; the harness itself doesn't.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { displayRefresh, frameTiming } from "../harness/frames.mjs";
import { gpuBusy } from "../harness/gpu.mjs";
import { profileParts } from "../harness/profile.mjs";

// qs.log as `qs --log-times` writes it: local wall-clock time to the ms.
const BASE = new Date(2026, 10, 6, 13, 0, 0).getTime() / 1000;
const pad = (n, w = 2) => String(n).padStart(w, "0");
function stamp(s) {
    const d = new Date(Math.round((BASE + s) * 1000));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}
const RENDER = "qt.scenegraph.time.renderloop: [window 0x7f0000000001][render thread 0x7f00000000a0]";
const frame = (s, render = RENDER) => `${stamp(s)} DEBUG ${render} syncAndRender: frame rendered in 0ms, sync=0, render=0, swap=0`;
const gpu = (s, ms) => `${stamp(s)} DEBUG ${RENDER} syncAndRender: last retrieved GPU frame time was ${ms} ms`;
const prepared = s => `${stamp(s)} DEBUG qt.scenegraph.time.renderloop: [window 0x7f0000000001][gui thread] Frame prepared, polish=0 ms, lock=0 ms, blockedForSync=0 ms, animations=0 ms`;

// Frames every `step` s from `from` to `to` (exclusive).
const frames = (from, to, step = 1 / 60, render) => {
    const lines = [];
    for (let i = 0; from + i * step < to - 1e-9; i++) lines.push(frame(from + i * step, render));
    return lines;
};
const window = { start: BASE + 1, end: BASE + 3, refreshMs: 1000 / 60 };

describe("harness frame timing", () => {
    test("a window rendered at every refresh has no late frames", () => {
        const log = [...frames(0, 4), prepared(2)].join("\n");
        const t = frameTiming(log, window);
        assert.equal(t.frames, 120);
        assert.equal(t.late, 0);
        assert.equal(t.missed, 0);
        assert.ok(Math.abs(t.fps - 60) < 0.5, `fps ${t.fps}`);
    });

    test("a frame more than half a refresh after its time is late, and counts the refreshes it missed", () => {
        // One refresh skipped at 1.5 s (33 ms apart), three in a row at 2 s (67 ms apart), and a
        // frame 20 ms after the last, which the display shows on time (jitter, not late).
        const skip = new Set([90, 120, 121, 122]);
        const lines = frames(0, 4).filter((_, i) => !skip.has(i));
        lines.splice(lines.indexOf(frame(150 / 60)), 1, frame(149 / 60 + 0.020));
        const t = frameTiming(lines.join("\n"), window);
        assert.equal(t.late, 2);
        assert.equal(t.missed, 4);
        assert.equal(t.worstMs, 67);
    });

    test("a pause of more than a quarter second is the scene at rest, not a late frame", () => {
        // Silence: the visualizer stops animating, so the render loop renders nothing for 1 s.
        const log = [...frames(0, 1.5), ...frames(2.5, 4)].join("\n");
        const t = frameTiming(log, window);
        assert.deepEqual([t.late, t.missed, t.idle], [0, 0, 1]);
        assert.ok(Math.abs(t.idleS - 1) < 0.02, `idle ${t.idleS} s`);
        assert.equal(t.worstMs, 17, "the pause isn't the worst interval");
    });

    test("each window's frames are timed on their own", () => {
        // Two windows (two screens) rendering at every refresh, half a refresh apart.
        const other = RENDER.replace("0x7f0000000001", "0x7f0000000002");
        const log = [...frames(0, 4), ...frames(1 / 120, 4, 1 / 60, other)].join("\n");
        const t = frameTiming(log, window);
        assert.equal(t.frames, 240);
        assert.equal(t.windows, 2);
        assert.equal(t.late, 0);
        assert.ok(Math.abs(t.fps - 60) < 0.5, `fps per window ${t.fps}`);
    });

    test("GPU frame time: Qt's timestamp-query readings in the window, mean, 95th percentile and worst", () => {
        // 100 frames in the window, 95 at 0.2 ms and 5 at 1 to 5 ms; one reading before the window.
        const readings = [...Array(95).fill(0.2), 1, 2, 3, 4, 5];
        const log = [gpu(0.5, 9), ...readings.map((ms, i) => gpu(1 + i * 0.01, ms.toFixed(4)))].join("\n");
        const t = frameTiming(log, window);
        assert.equal(t.gpu.frames, 100);
        assert.ok(Math.abs(t.gpu.meanMs - 0.34) < 1e-9, `mean ${t.gpu.meanMs}`);
        assert.equal(t.gpu.p95Ms, 0.2);
        assert.equal(t.gpu.maxMs, 5);
    });

    test("the display's refresh comes from Hyprland's monitors, the slowest one if they differ", () => {
        const monitor = (name, refreshRate) => ({ name, refreshRate, disabled: false });
        assert.deepEqual(displayRefresh([monitor("HDMI-A-3", 59.973)]), { hz: 59.973, monitors: 1 });
        assert.deepEqual(displayRefresh([monitor("DP-1", 143.9), monitor("DP-2", 60)]), { hz: 60, monitors: 2 });
        assert.equal(displayRefresh([]), null);
    });
});

// A snapshot as the harness takes it: the time, then each /dev/dri fd's fdinfo of each process.
const snapshot = (ns, ...fds) => [`time ${ns}`, ...fds.flatMap(([pid, fd, lines]) => [`fdinfo ${pid} ${fd}`, "pos:\t0", "flags:\t02100002", ...lines])].join("\n");
const xe = (client, rcs, total, ccs = 0) => [
    "drm-driver:\txe", `drm-client-id:\t${client}`, "drm-pdev:\t0000:03:00.0", "drm-total-vram0:\t14364 KiB",
    `drm-cycles-rcs:\t${rcs}`, `drm-total-cycles-rcs:\t${total}`,
    `drm-cycles-ccs:\t${ccs}`, `drm-total-cycles-ccs:\t${total}`, "drm-engine-capacity-ccs:\t4",
];

describe("harness GPU busy", () => {
    test("xe: an engine's busy share is its cycles over the GPU's, a client counted once however many fds it has", () => {
        const before = snapshot(0, [7, 26, xe(278, 1000, 1_000_000, 0)], [7, 27, xe(278, 1000, 1_000_000, 0)]);
        const after = snapshot(1e9, [7, 26, xe(278, 21000, 2_000_000, 40000)], [7, 27, xe(278, 21000, 2_000_000, 40000)]);
        const busy = gpuBusy(before, after);
        assert.equal(busy.render.engine, "rcs");
        assert.ok(Math.abs(busy.render.pct - 2) < 1e-9, `rcs ${busy.render.pct}`);
        // Four compute engines: 40000 of 4 x 1000000 cycles.
        assert.ok(Math.abs(busy.engines.ccs - 1) < 1e-9, `ccs ${busy.engines.ccs}`);
        assert.equal(busy.clients, 1);
    });

    test("amdgpu: engine time in ns against the window's wall time; a client opened mid-window doesn't count", () => {
        const amd = ns => ["drm-driver:\tamdgpu", "drm-pdev:\t0000:7c:00.0", "drm-client-id:\t12", `drm-engine-gfx:\t${ns} ns`, "drm-engine-compute:\t0 ns"];
        const late = ["drm-driver:\tamdgpu", "drm-pdev:\t0000:7c:00.0", "drm-client-id:\t13", "drm-engine-gfx:\t900000000 ns"];
        const busy = gpuBusy(snapshot(5e9, [7, 30, amd(1e9)]), snapshot(7e9, [7, 30, amd(1.05e9)], [7, 31, late]));
        assert.equal(busy.render.engine, "gfx");
        assert.ok(Math.abs(busy.render.pct - 2.5) < 1e-9, `gfx ${busy.render.pct}`);
        assert.equal(busy.engines.compute, 0);
        assert.equal(busy.clients, 1);
    });

    test("no GPU client in the window: nothing to report", () => {
        assert.equal(gpuBusy(snapshot(0), snapshot(1e9)).render, null);
    });
});

// `perf report --sort comm,dso -F sample,period,comm,dso -t '\t'`: one row per thread name and
// library, padded. Periods are cycles; these add up to 1000 so each is its own per mille.
const row = (period, comm, dso) => ` 1          \t ${String(period).padEnd(11)}\t${comm.padEnd(15)}\t${dso.padEnd(29)}`;
const REPORT = [
    row(250, "qs", "libQt6Qml.so.6.12.0"),
    row(20, "qs", "memfd:JITCode:QtQml (deleted)"),
    row(30, "qs", "libQt6Quick.so.6.12.0"),
    row(10, "qs", "quickshell"),
    row(100, "qs", "libQt6Core.so.6.12.0"),
    row(60, "qs", "libc.so.6"),
    row(150, "QSGRenderThread", "libgallium-26.2.6-arch1.1.so"),
    row(15, "QSGRenderThread", "libEGL_mesa.so.0.0.0"),
    row(10, "QSGRenderThread", "libGLdispatch.so.0.0.0"),
    row(5, "QSGRenderThread", "libQt6Quick.so.6.12.0"),
    row(40, "QSGRenderThread", "libQt6Core.so.6.12.0"),
    row(50, "WaylandEventThr", "libQt6Core.so.6.12.0"),
    row(30, "QThread", "libjemalloc.so.2"),
    row(90, "cava", "libpython3.14.so.1.0"),
    row(100, "pactl", "libpulsecommon-17.0.so"),
    row(30, "sh", "bash"),
    row(10, "ls", "ld-linux-x86-64.so.2"),
    "",
].join("\n");

describe("harness CPU profile", () => {
    test("perf's samples split into the parts of the work, by thread and library", () => {
        const { total, parts } = profileParts(REPORT);
        assert.equal(total, 1000);
        const share = Object.fromEntries(parts.map(p => [p.part, p.period]));
        assert.deepEqual(share, {
            "JS engine": 270,                 // QML's engine and its JIT's code, on the gui thread
            "Qt Quick, gui thread": 30,
            "Quickshell": 10,
            "gui thread, the rest": 160,      // Qt Core's event loop, libc, malloc
            "scene graph, render thread": 45,
            "GPU driver, render thread": 175, // mesa, EGL, libglvnd
            "qs, other threads": 80,
            "capture": 90,
            "pactl": 100,
            "sh and other children": 40,
        });
    });
});

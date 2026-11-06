// The harness's CPU profile, summed into the parts of the work: which thread (qs's gui thread, its
// render thread, its other threads, the capture, pactl, the shells qs starts) and, in qs, which
// library. Reads `perf report --no-children -g none --sort comm,dso -F sample,period,comm,dso -t '\t'`.
//
//   node harness/profile.mjs <report.tsv> [--json FILE]
//
// Self time only: malloc or libc called from the JS engine counts as "gui thread, the rest", not as
// the JS engine. For who calls what, open perf.data in a viewer (CONTRIBUTING.md, Measuring).

// The parts, in the order they're reported, with what decides each: the thread's name and the
// library its sample was in.
const DRIVER = /^(libgallium|libEGL|libGLX|libGLdispatch|libGL\.|libOpenGL|libdrm|libgbm|libglapi|libvulkan|libLLVM|.*_dri\.so)/;
const JS = /^libQt6Qml|JITCode|^perf-\d+\.map|^\[JIT\]/;
const QS_THREAD = /^(qs$|Q|Wayland|gmain|gdbus|pool|Thread)/;   // Qt's and glib's thread names
const PARTS = [
    ["JS engine", (comm, dso) => comm === "qs" && JS.test(dso)],
    ["Qt Quick, gui thread", (comm, dso) => comm === "qs" && dso.startsWith("libQt6Quick")],
    ["Quickshell", (comm, dso) => QS_THREAD.test(comm) && comm !== "QSGRenderThread" && /^(quickshell|qs$|libquickshell)/.test(dso)],
    ["gui thread, the rest", comm => comm === "qs"],
    ["GPU driver, render thread", (comm, dso) => comm === "QSGRenderThread" && DRIVER.test(dso)],
    ["scene graph, render thread", comm => comm === "QSGRenderThread"],
    ["qs, other threads", comm => QS_THREAD.test(comm)],
    ["capture", comm => comm === "cava"],
    ["pactl", comm => comm === "pactl"],
    ["sh and other children", () => true],
];

// Each part's period (cycles) and share of the total, plus the total and the sample count.
export function profileParts(report) {
    const period = new Map(PARTS.map(([part]) => [part, 0]));
    let total = 0, samples = 0;
    for (const line of report.split("\n")) {
        const cols = line.split("\t").map(c => c.trim());
        if (cols.length < 4 || !/^\d+$/.test(cols[1])) continue;
        const [n, p, comm, dso] = [Number(cols[0]), Number(cols[1]), cols[2], cols[3]];
        const [part] = PARTS.find(([, match]) => match(comm, dso));
        period.set(part, period.get(part) + p);
        total += p;
        samples += n;
    }
    return {
        total, samples,
        parts: [...period].map(([part, p]) => ({ part, period: p, pct: total ? (p / total) * 100 : 0 })),
    };
}

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const args = process.argv.slice(2);
    const json = args.includes("--json") ? args.splice(args.indexOf("--json"), 2)[1] : null;
    const { samples, parts } = profileParts(fs.readFileSync(args[0], "utf8"));
    const share = parts.map(p => `${p.part} ${p.pct.toFixed(1)}`);
    console.log(`profile  ${samples} samples (user space), % of them: ${share.slice(0, 4).join(", ")},`);
    console.log(`         ${share.slice(4).join(", ")}`);
    if (json)
        fs.writeFileSync(json, JSON.stringify({
            profile_samples: samples,
            profile_pct: Object.fromEntries(parts.map(p => [p.part, Number(p.pct.toFixed(1))])),
        }));
}

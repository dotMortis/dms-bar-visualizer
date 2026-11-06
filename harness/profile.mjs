// The harness's CPU profile, summed into the parts of the work: which thread (qs's gui thread, its
// render thread, its other threads, the capture, pactl, the shells qs starts) and, in qs, which
// library. Reads `perf report --no-children -g none --sort comm,dso -F sample,period,comm,dso -t '\t'`.
//
//   node harness/profile.mjs <report.tsv> [--json FILE]
//   node harness/profile.mjs --breakdown <dir>...
//
// --breakdown: the parts as % of one core, per host and scenario, from the runs with every
// measure under the dirs (harness/run --out). A run's perf.data is read again, so the parts
// below apply to runs made before they changed.
//
// Self time only: malloc or libc called from the JS engine counts as "gui thread, the rest", not as
// the JS engine. For who calls what, open perf.data in a viewer (CONTRIBUTING.md, Measuring).

// The parts, in the order they're reported, with what decides each: the thread's name and the
// library its sample was in.
const DRIVER = /^(libgallium|libEGL|libGLX|libGLdispatch|libGL\.|libOpenGL|libdrm|libgbm|libglapi|libvulkan|libLLVM|.*_dri\.so)/;
const JS = /^libQt6Qml|JITCode|^perf-\d+\.map|^\[JIT\]/;
const QS_THREAD = /^(qs$|Q|Wayland|gmain|gdbus|pool|Thread)/;   // Qt's and glib's thread names
// Mesa's own threads in qs, named "<process>:<thread>": gallium's driver thread (gdrv0), its shader
// compiler (sh0) and its disk cache (disk$0).
const MESA_THREAD = /^qs:(gdrv|sh|disk\$)\d+$/;
const PARTS = [
    ["JS engine", (comm, dso) => comm === "qs" && JS.test(dso)],
    ["Qt Quick, gui thread", (comm, dso) => comm === "qs" && dso.startsWith("libQt6Quick")],
    ["Quickshell", (comm, dso) => QS_THREAD.test(comm) && comm !== "QSGRenderThread" && /^(quickshell|qs$|libquickshell)/.test(dso)],
    ["gui thread, the rest", comm => comm === "qs"],
    ["GPU driver, render thread", (comm, dso) => comm === "QSGRenderThread" && DRIVER.test(dso)],
    ["scene graph, render thread", comm => comm === "QSGRenderThread"],
    ["GPU driver, its own threads", comm => MESA_THREAD.test(comm)],
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

// One cell per host and scenario from runs with a profile (harness/run's result.json): each part's
// share of user space times the run's user CPU, so % of one core, and the run's system time as the
// kernel's part (the profile has no kernel samples). Several runs: the median of each.
export function profileBreakdown(results) {
    const median = xs => {
        const s = [...xs].sort((a, b) => a - b), mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    };
    const round = x => Math.round(x * 100) / 100;
    const cells = new Map();
    for (const r of results) {
        if (!r.profile_pct) continue;
        const key = `${r.host} ${r.scenario}`;
        if (!cells.has(key)) cells.set(key, { host: r.host, scenario: r.scenario, runs: [] });
        cells.get(key).runs.push({
            cpu: r.cpu_pct,
            parts: {
                ...Object.fromEntries(Object.entries(r.profile_pct).map(([part, pct]) => [part, (r.cpu_user_pct * pct) / 100])),
                kernel: r.cpu_system_pct,
            },
        });
    }
    return [...cells.values()].map(({ host, scenario, runs }) => ({
        host, scenario, runs: runs.length,
        cpu: round(median(runs.map(r => r.cpu))),
        parts: Object.fromEntries(Object.keys(runs[0].parts).map(part => [part, round(median(runs.map(r => r.parts[part] ?? 0)))])),
    }));
}

// The breakdown as a Markdown table: a row per host and scenario, a column per part.
function breakdownTable(cells) {
    const parts = [...PARTS.map(([part]) => part), "kernel"];
    return [
        `| Host | Scenario | Runs | CPU | ${parts.join(" | ")} |`,
        `| --- | --- | --- | --- | ${parts.map(() => "---").join(" | ")} |`,
        ...cells.map(c => `| ${c.host} | ${c.scenario} | ${c.runs} | ${c.cpu.toFixed(1)} | ${parts.map(p => (c.parts[p] ?? 0).toFixed(2)).join(" | ")} |`),
    ].join("\n") + "\n";
}

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const { default: path } = await import("node:path");
    const { execFileSync } = await import("node:child_process");
    const args = process.argv.slice(2);
    if (args[0] === "--breakdown") {
        const results = args.slice(1).flatMap(dir => fs.readdirSync(dir, { recursive: true })
            .filter(f => path.basename(f) === "result.json").map(f => path.join(dir, f))).sort()
            .map(file => {
                const r = JSON.parse(fs.readFileSync(file, "utf8"));
                const data = path.join(path.dirname(file), "perf.data");
                if (r.profile_pct && fs.existsSync(data)) {
                    const report = execFileSync("perf", ["report", "-i", data, "--stdio", "--no-children", "-g", "none", "-q",
                        "--sort", "comm,dso", "-F", "sample,period,comm,dso", "--percent-limit", "0", "-t", "\t"],
                    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
                    r.profile_pct = Object.fromEntries(profileParts(report).parts.map(p => [p.part, p.pct]));
                }
                return r;
            });
        process.stdout.write(breakdownTable(profileBreakdown(results)));
    } else {
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
}

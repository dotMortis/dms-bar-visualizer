// The performance page's results table (docs/performance.md) from harness/run's result.json files.
//
//   node harness/table.mjs [--max-load L] [--runs] <dir>...
//
//   dirs: searched for result.json (harness/run --out); --max-load: leave out runs that started at
//   a 1-minute load average over L; --runs: list the runs (load, CPU, kind) instead of the tables

// Median and spread of a list of numbers.
function spread(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    const median = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    return { median, min: s[0], max: s.at(-1), n: s.length };
}

// What a run with every measure (no --cpu-only) adds, each summed over that kind of run alone.
export const MEASURES = ["cpu_pct", "frames_fps", "frames_late", "gpu_frame_ms_mean", "gpu_frame_ms_p95", "gpu_busy_pct"];
const isFull = r => "frames_fps" in r;
const load1 = r => Number(String(r.loadavg).split(" ")[0]);

// One cell per commit, host and scenario: the --cpu-only runs' CPU and the other runs' measures,
// leaving out runs that started at a 1-minute load average over maxLoad.
export function summarize(results, { maxLoad = Infinity } = {}) {
    const cells = new Map();
    for (const r of results) {
        if (load1(r) > maxLoad) continue;
        const key = `${r.commit} ${r.host} ${r.scenario}`;
        if (!cells.has(key)) cells.set(key, { commit: r.commit, tree: r.tree, host: r.host, scenario: r.scenario, runs: [] });
        cells.get(key).runs.push(r);
    }
    return [...cells.values()].map(c => {
        const cpuOnly = c.runs.filter(r => !isFull(r)), full = c.runs.filter(isFull);
        const measured = Object.fromEntries(MEASURES.map(m => {
            const xs = full.map(r => r[m]).filter(x => typeof x === "number");
            return [m, xs.length ? spread(xs) : null];
        }));
        return { ...c, cpu: cpuOnly.length ? spread(cpuOnly.map(r => r.cpu_pct)) : null, measured };
    });
}

const HOSTS = ["bar", "lock"];
const SCENARIOS = ["music", "music_lyrics", "silence_no_player", "silence_paused", "silence_playing"];
// The tables, in order: a title and how a cell reads its number from a cell, with its decimals.
const TABLES = [
    ["CPU, --cpu-only: % of one core (qs + capture + children)", c => c.cpu, 1],
    ["CPU with every measure on: % of one core", c => c.measured.cpu_pct, 1],
    ["Frames per second, per window", c => c.measured.frames_fps, 1],
    ["Late frames, per window of one loop", c => c.measured.frames_late, 0],
    ["GPU frame time, mean: ms", c => c.measured.gpu_frame_ms_mean, 3],
    ["GPU frame time, 95th percentile: ms", c => c.measured.gpu_frame_ms_p95, 3],
    ["GPU busy: % of the render engine", c => c.measured.gpu_busy_pct, 2],
];

// "v0.10.0 (<sha>)" or "working tree at v0.10.0-3-gabc1234": the name a step goes by.
const stepName = tree => String(tree).replace(/^working tree at /, "").replace(/ \(.*\)$/, "");

// A cell: the median, then the spread (lowest-highest) and the number of runs when there were several.
function cellText(s, decimals) {
    if (!s) return "-";
    const f = x => x.toFixed(decimals);
    return s.n > 1 ? `${f(s.median)} (${f(s.min)}-${f(s.max)}, ${s.n})` : f(s.median);
}

// Markdown: one table per measure, a row per step (commit, in the order first seen), a column per
// host and scenario.
export function resultTables(cells) {
    const steps = [...new Map(cells.map(c => [c.commit, stepName(c.tree)]))];
    const columns = HOSTS.flatMap(h => SCENARIOS.map(s => [h, s]));
    return TABLES.map(([title, pick, decimals]) => [
        `**${title}**`,
        "",
        `| Step | Commit | ${columns.map(([h, s]) => `${h} ${s}`).join(" | ")} |`,
        `| --- | --- | ${columns.map(() => "---").join(" | ")} |`,
        ...steps.map(([commit, name]) => `| ${name} | ${commit.slice(0, 7)} | ${columns.map(([h, s]) => {
            const cell = cells.find(c => c.commit === commit && c.host === h && c.scenario === s);
            return cellText(cell && pick(cell), decimals);
        }).join(" | ")} |`),
    ].join("\n")).join("\n\n") + "\n";
}

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const { default: path } = await import("node:path");
    const args = process.argv.slice(2);
    const option = name => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : null);
    const maxLoad = Number(option("--max-load") ?? Infinity);
    const listRuns = args.includes("--runs") && args.splice(args.indexOf("--runs"), 1);
    const files = args.flatMap(dir => fs.readdirSync(dir, { recursive: true })
        .filter(f => path.basename(f) === "result.json").map(f => path.join(dir, f))).sort();
    const results = files.map(f => ({ ...JSON.parse(fs.readFileSync(f, "utf8")), file: f }));
    if (listRuns)
        for (const r of results)
            console.log(`${load1(r) > maxLoad ? "left out" : "        "}  load ${r.loadavg}  cpu ${String(r.cpu_pct).padStart(5)}  `
                + `${isFull(r) ? "full" : "cpu "}  ${r.host} ${r.scenario}  ${path.dirname(r.file)}`);
    else process.stdout.write(resultTables(summarize(results, { maxLoad })));
}

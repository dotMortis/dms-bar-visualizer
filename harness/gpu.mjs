// The harness's GPU busy measure: how much of the GPU's engines the run's processes kept busy over
// the window, from the DRM driver's per-client counters in /proc/<pid>/fdinfo/<fd>
// (https://docs.kernel.org/gpu/drm-usage-stats.html). Two snapshots, taken by harness/run: a
// "time <ns>" line, then "fdinfo <pid> <fd>" and that fd's fdinfo for each /dev/dri fd.
//
//   node harness/gpu.mjs <before> <after> [--json FILE]

// The engine that draws: xe's and i915's render engine, amdgpu's graphics one.
const RENDER = ["rcs", "render", "gfx"];

// Each DRM client in a snapshot (one per open of the device; dup'd fds share it), by GPU and id.
function parse(text) {
    let time = 0, fd = null;
    const clients = new Map(), fds = [];
    for (const line of text.split("\n")) {
        if (line.startsWith("time ")) time = Number(line.slice(5));
        else if (line.startsWith("fdinfo ")) fds.push((fd = {}));
        else if (fd) {
            const m = line.match(/^([\w-]+):\s*(\d+)/);
            if (m) fd[m[1]] = Number(m[2]);
            const pdev = line.match(/^drm-pdev:\s*(\S+)/);
            if (pdev) fd.pdev = pdev[1];
        }
    }
    for (const f of fds) {
        if (f["drm-client-id"] === undefined) continue;
        const engines = {};
        for (const [key, value] of Object.entries(f)) {
            let m;
            if ((m = key.match(/^drm-cycles-(.+)$/)) && f[`drm-total-cycles-${m[1]}`] !== undefined)
                engines[m[1]] = { used: value, total: f[`drm-total-cycles-${m[1]}`] };
            else if ((m = key.match(/^drm-engine-(?!capacity-)(.+)$/)))
                engines[m[1]] = { used: value, total: null };   // ns busy, against wall time
        }
        for (const name of Object.keys(engines)) engines[name].capacity = f[`drm-engine-capacity-${name}`] ?? 1;
        clients.set(`${f.pdev ?? ""}/${f["drm-client-id"]}`, engines);
    }
    return { time, clients };
}

// Per engine, % of it the clients in both snapshots kept busy (100 % = all its instances, all the
// time), and the render engine's.
export function gpuBusy(beforeText, afterText) {
    const before = parse(beforeText), after = parse(afterText);
    const wall = after.time - before.time;
    const engines = {};
    let clients = 0;
    for (const [id, now] of after.clients) {
        const was = before.clients.get(id);
        if (!was) continue;
        clients++;
        for (const [name, e] of Object.entries(now)) {
            const w = was[name];
            if (!w) continue;
            const span = e.total === null ? wall : e.total - w.total;
            if (span > 0) engines[name] = (engines[name] ?? 0) + ((e.used - w.used) / (span * e.capacity)) * 100;
        }
    }
    const names = Object.keys(engines);
    const engine = names.find(n => RENDER.includes(n)) ?? names.sort((a, b) => engines[b] - engines[a])[0];
    return { clients, engines, render: engine ? { engine, pct: engines[engine] } : null };
}

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const args = process.argv.slice(2);
    const json = args.includes("--json") ? args.splice(args.indexOf("--json"), 2)[1] : null;
    const [before, after] = args.map(f => fs.readFileSync(f, "utf8"));
    const busy = gpuBusy(before, after);
    const pct = x => Number(x.toFixed(2));
    if (busy.render) {
        const others = Object.entries(busy.engines).filter(([n, v]) => n !== busy.render.engine && v >= 0.005)
            .map(([n, v]) => `${n} ${v.toFixed(2)}`).join(", ");
        console.log(`gpu      busy ${busy.render.pct.toFixed(2)} % of the render engine (${busy.render.engine}, the driver's fdinfo)${others ? `, other engines: ${others} %` : ""}`);
    } else console.log("gpu      no GPU client in the scope over the window (no /dev/dri fd with fdinfo counters)");
    if (json)
        fs.writeFileSync(json, JSON.stringify(busy.render
            ? { gpu_busy_pct: pct(busy.render.pct), gpu_busy_engine: busy.render.engine, gpu_engines_pct: Object.fromEntries(Object.entries(busy.engines).map(([n, v]) => [n, pct(v)])) }
            : { gpu_busy_pct: null }));
}

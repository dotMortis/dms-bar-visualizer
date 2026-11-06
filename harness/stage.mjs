// The recording stage of harness/run --record: a compositor of its own, headless, that the run shows
// on instead of the desktop, so a recording holds the visualizer's window and nothing else. Its
// size follows the desktop's monitor, so the bar is as wide as there; a recording keeps just the
// visualizer's window. Sizes are even: the encoder (libx264, yuv420p) takes no odd ones.
//
//   node harness/stage.mjs mode <hyprctl -j monitors of the desktop>   e.g. 3224x1350@60
//   node harness/stage.mjs region <hyprctl -j layers of the stage> <namespace>   e.g. 0,0 3224x44

const even = x => Math.max(2, Math.floor(x / 2) * 2);

// The stage's monitor mode: the desktop's first monitor in logical pixels (its size over its scale).
export function stageMode(monitors) {
    const m = monitors[0];
    if (!m) return "1920x1080@60";
    return `${even(Math.round(m.width / m.scale))}x${even(Math.round(m.height / m.scale))}@60`;
}

// wf-recorder's -g for the layer-shell window by that namespace, or null when there's none.
export function recordRegion(layers, namespace) {
    for (const monitor of Object.values(layers))
        for (const level of Object.values(monitor.levels ?? {}))
            for (const l of level)
                if (l.namespace === namespace) return `${l.x},${l.y} ${even(l.w)}x${even(l.h)}`;
    return null;
}

if (import.meta.main) {
    const { default: fs } = await import("node:fs");
    const [what, file, namespace] = process.argv.slice(2);
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const out = what === "mode" ? stageMode(json) : recordRegion(json, namespace);
    if (!out) process.exit(1);
    console.log(out);
}

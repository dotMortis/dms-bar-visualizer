// The parity check (spec #41): the WASM build must fire exactly the same Kicks, at the same times
// with the same powers, as the native build, on every recorded fixture at both replay configs, so
// the demo can't drift from what runs on the desktop. The rest of the frame (the clock, flow, Kick
// level and slots, Silence, animating) must come out the same too, checked on each replay's last
// frame, which every frame before it feeds. So must the Lyric Words' glyph instances, over the demo
// song sung on one fixture (examples/glyphs.rs).
//
//     node core/parity.mjs
//
// Builds the WASM (core/build-wasm.sh, into core/target/wasm-web) and the native replay
// (examples/kicks.rs), replays tests/fixtures through both and compares bit for bit. Needs the
// wasm32-unknown-unknown target and the matching wasm-bindgen CLI (see core/build-wasm.sh).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const core = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(core, "../tests/fixtures");
const pkg = path.join(core, "target/wasm-web");
const BANDS = 32;

function run(cmd, args) {
    try {
        return execFileSync(cmd, args, { cwd: core, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
    } catch (e) {
        console.error(`parity: ${path.basename(cmd)} ${args.join(" ")} failed (${e.status ?? e.code})`);
        process.exit(2);
    }
}

run(path.join(core, "build-wasm.sh"), [pkg]);
// One line per scenario and config: {scenario, config, settings, kicks: [[time, power], ...]}.
const native = run("cargo", ["run", "--quiet", "--release", "--example", "kicks"])
    .trimEnd().split("\n").map(line => JSON.parse(line));

const { initSync, Visualizer } = await import(path.join(pkg, "visualizer_core.js"));
initSync({ module: fs.readFileSync(path.join(pkg, "visualizer_core_bg.wasm")) });

// A recording's frames as the core's tests read them (core/tests/common/mod.rs): "<time> <cava
// raw line>", a line with fewer than BANDS bands dropped.
function frames(scenario) {
    const [, ...lines] = fs.readFileSync(path.join(fixtures, `${scenario}.txt`), "utf8").trimEnd().split("\n");
    const out = [];
    for (const line of lines) {
        const [time, raw] = line.split(" ");
        const parts = raw.split(";");
        if (parts.length < BANDS || parts[BANDS - 1] === "")
            continue;
        out.push({ time: Number(time), values: Float64Array.from(parts.slice(0, BANDS), p => Number(p) / 1000) });
    }
    return out;
}

function replay(scenario, settings) {
    const visualizer = new Visualizer();
    visualizer.configure(settings);
    let count = visualizer.frame().kickCount;
    const kicks = [];
    for (const { time, values } of frames(scenario)) {
        visualizer.pushBands(values, time);
        const frame = visualizer.frame();
        if (frame.kickCount !== count) {
            count = frame.kickCount;
            kicks.push([time, frame.kickPower]);
        }
    }
    visualizer.free();
    return kicks;
}

// examples/kicks.rs's last_frame, through the WASM.
const SILENCE = { "": 0, "no-player": 1, "paused": 2, "silent": 3 };
function lastFrame(scenario, settings) {
    const visualizer = new Visualizer();
    visualizer.configure(settings);
    visualizer.setPlayer("playing");
    for (const { time, values } of frames(scenario)) {
        visualizer.pushBands(values, time);
        visualizer.advance(1 / 60);
    }
    const f = visualizer.frame();
    const out = [f.time, f.flow, f.kick, f.intensity, f.bassStretch, ...f.kickAges, ...f.kickPowers, ...f.kickSeeds,
        SILENCE[f.silence], f.animating ? 1 : 0];
    visualizer.free();
    return out;
}

const scenarios = fs.readdirSync(fixtures).filter(f => f.endsWith(".txt")).map(f => f.slice(0, -4)).sort();
const covered = new Set(native.map(r => r.scenario));
const failures = scenarios.filter(s => !covered.has(s)).map(s => `${s}: no native replay`);
let kicks = 0;
for (const { scenario, config, settings, kicks: expected, frame } of native) {
    const last = lastFrame(scenario, settings);
    const at = last.findIndex((x, i) => !Object.is(x, frame[i]));
    if (last.length !== frame.length || at >= 0)
        failures.push(`${scenario} at ${config}: last frames differ at ${at}: WASM ${last[at]}, native ${frame[at]}`);
    const got = replay(scenario, settings);
    kicks += expected.length;
    const first = got.findIndex((k, i) => !expected[i] || !Object.is(k[0], expected[i][0]) || !Object.is(k[1], expected[i][1]));
    if (got.length !== expected.length || first >= 0) {
        const i = first >= 0 ? first : Math.min(got.length, expected.length);
        failures.push(`${scenario} at ${config}: ${got.length} Kicks in WASM, ${expected.length} native; ` +
            `first difference at Kick ${i}: WASM ${JSON.stringify(got[i])}, native ${JSON.stringify(expected[i])}`);
    }
}
// The Lyric Words: examples/glyphs.rs's run through the WASM, its glyphs every GLYPH_EVERY frames.
const GLYPH_EVERY = 15, LETTERS = "abcdefghijklmnopqrstuvwxyzENRVWS,";
function glyphRun() {
    const visualizer = new Visualizer();
    visualizer.configure(native.find(r => r.config === "defaults")?.settings ?? native[0].settings);
    visualizer.setSeed(42);
    visualizer.setBarSize(1200, 36);
    visualizer.setLetters(LETTERS, Float64Array.from(Array.from(LETTERS), (_, i) => 0.3 + 0.01 * i), 1.3);
    visualizer.setTrack("demo", 24);
    visualizer.setLyrics(`{"found": true, "synced": ${fs.readFileSync(path.join(core, "../harness/lyrics.json"), "utf8")}}`);
    visualizer.setPlayer("playing");
    visualizer.setPosition(0.5, 1);
    const snapshots = [];
    frames("steady_house").forEach(({ time, values }, n) => {
        visualizer.pushBands(values, time);
        visualizer.advance(1 / 60);
        if (n % GLYPH_EVERY === 0) {
            const { count, stride, data } = visualizer.glyphs();
            snapshots.push(Array.from(data.subarray(0, count * stride)));
        }
    });
    visualizer.free();
    return snapshots;
}
const nativeGlyphs = JSON.parse(run("cargo", ["run", "--quiet", "--release", "--example", "glyphs"])).glyphs;
const wasmGlyphs = glyphRun();
let glyphs = 0;
nativeGlyphs.forEach((expected, i) => {
    const got = wasmGlyphs[i] ?? [];
    glyphs += expected.length / 35;
    const at = got.findIndex((x, j) => !Object.is(x, expected[j]));
    if (got.length !== expected.length || at >= 0)
        failures.push(`glyphs at frame ${i * GLYPH_EVERY}: ${got.length / 35} in WASM, ${expected.length / 35} native; first difference at number ${at}: WASM ${got[at]}, native ${expected[at]}`);
});
if (!glyphs)
    failures.push("glyphs: the Lyric Words never showed");

if (failures.length || !native.length) {
    console.error(`parity: WASM and native Kicks differ\n${failures.join("\n") || "no native replays"}`);
    process.exit(1);
}
console.log(`parity: ok, ${glyphs} glyphs over ${nativeGlyphs.length} snapshots, ${kicks} Kicks and the last frames identical in WASM and native over ${native.length} replays (${scenarios.length} fixtures x ${native.length / scenarios.length} configs)`);

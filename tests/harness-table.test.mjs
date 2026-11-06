// The performance page's results table (docs/performance.md), from the harness's result.json
// files: what harness/table.mjs makes of them. Only the summing and the table run here.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { resultTables, summarize } from "../harness/table.mjs";

const V010 = "255ff1ff5165c17bedc3e564aec28a6054d24569";
// A --cpu-only run's result.json, cut to what the table reads.
const cpuRun = (cpu, over = {}) => ({
    scenario: "music", host: "bar", commit: V010, tree: `v0.10.0 (${V010})`, loadavg: "1.10 2.00 3.00", cpu_pct: cpu, ...over,
});

describe("harness results table", () => {
    test("a cell's CPU is the median of its --cpu-only runs, with their spread", () => {
        const [cell] = summarize([cpuRun(2.0), cpuRun(1.5), cpuRun(9.0)]);
        assert.equal(cell.cpu.median, 2.0);
        assert.deepEqual([cell.cpu.min, cell.cpu.max, cell.cpu.n], [1.5, 9.0, 3]);
    });

    test("a run with every measure gives the frames and GPU, and its CPU (which the measures raise) apart", () => {
        const full = cpuRun(3.0, { frames_fps: 59.8, frames_late: 2, gpu_frame_ms_mean: 0.12, gpu_frame_ms_p95: 0.2, gpu_busy_pct: 1.3 });
        const [cell] = summarize([cpuRun(2.0), full]);
        assert.deepEqual([cell.cpu.median, cell.cpu.n], [2.0, 1]);
        assert.equal(cell.measured.cpu_pct.median, 3.0);
        assert.equal(cell.measured.frames_fps.median, 59.8);
        assert.equal(cell.measured.frames_late.median, 2);
        assert.equal(cell.measured.gpu_frame_ms_p95.median, 0.2);
        assert.equal(cell.measured.gpu_busy_pct.median, 1.3);
    });

    test("a run under a load spike is left out", () => {
        const [cell] = summarize([cpuRun(2.0), cpuRun(30.0, { loadavg: "6.00 2.00 1.00" })], { maxLoad: 3 });
        assert.deepEqual([cell.cpu.median, cell.cpu.n], [2.0, 1]);
    });

    test("each measure's table has a row per step and a column per host and scenario, median and spread in each cell", () => {
        const md = resultTables(summarize([
            cpuRun(2.0), cpuRun(1.5), cpuRun(9.0),
            cpuRun(4.25, { host: "lock", scenario: "silence_paused" }),
        ]));
        const cpu = md.split(/\n\n(?=\*\*)/).find(t => t.includes("CPU, --cpu-only")).split("\n");
        const header = cpu.find(l => l.startsWith("| Step"));
        assert.equal(header, "| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing "
            + "| lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |");
        assert.equal(cpu.at(-1), "| v0.10.0 | 255ff1f | 2.0 (1.5-9.0, 3) | - | - | - | - | - | - | - | 4.3 | - |");
    });
});

// Replay recorded cava output through the kick detector and score its kicks against the true onsets.
// Shared by the replay tests: the fixtures and configs, replaying frames, scoring the kicks, and
// reporting or checking the result against a budget.
import fs from "node:fs";

import { BANDS, createKickDetector } from "../docs/kick.mjs";

// The settings the replay tests hold the detector to: the defaults, and a sensitive config.
export const CONFIGS = {
    defaults: { kickThreshold: 0.2, kickLowHz: 30, kickHighHz: 79, kickCooldown: 0.1 },
    sensitive: { kickThreshold: 0.2, kickLowHz: 30, kickHighHz: 90, kickCooldown: 0.1 },
};

// Every recording in fixtures/, by scenario, and the scenarios with kicks (all but the tone sweep).
export const SCENARIOS = fs.readdirSync(new URL("fixtures/", import.meta.url))
    .filter(f => f.endsWith(".txt")).map(f => f.slice(0, -4)).sort();
export const FIXTURES = Object.fromEntries(SCENARIOS.map(s => [s, readFixture(s)]));
export const TRACKS = SCENARIOS.filter(s => FIXTURES[s].onsets.length);

// A fixture recorded by fixtures/record.py: its JSON header (scenario, about, cava, onsets, ...)
// plus frames, [{ time, values }], parsed the way shell.qml parses cava's lines.
function readFixture(scenario) {
    const text = fs.readFileSync(new URL(`fixtures/${scenario}.txt`, import.meta.url), "utf8");
    const [header, ...lines] = text.trimEnd().split("\n");
    const frames = [];
    for (const line of lines) {
        const [time, raw] = line.split(" ");
        const parts = raw.split(";");
        if (parts.length < BANDS)
            continue;
        frames.push({ time: Number(time), values: parts.slice(0, BANDS).map(p => parseInt(p, 10) / 1000) });
    }
    return { ...JSON.parse(header), frames };
}

// Push frames through a detector with these kick settings (and speed, 1 if left out); returns its
// kicks, [{ time, power }], on the frames' real-time clock.
export function replay(frames, settings) {
    const detector = createKickDetector(settings);
    const kicks = [];
    for (const { time, values } of frames) {
        const kick = detector.push(values, time);
        if (kick)
            kicks.push({ time, ...kick });
    }
    return kicks;
}

// The frames pushed fps times a second instead of 60, the way the demo pushes one frame per display
// refresh: each frame repeated as often as an fps Hz display refreshes before the next frame comes
// (twice at 120 Hz, two or three times at 144 Hz), the repeats spread evenly from the frame's own time.
export function atFrameRate(frames, fps) {
    const refreshes = time => Math.floor((time - frames[0].time) * fps + 0.5);
    const pushed = [];
    for (let i = 0; i < frames.length; i++) {
        const { time, values } = frames[i];
        const next = i + 1 < frames.length ? frames[i + 1].time : time;
        const repeats = Math.max(1, refreshes(next) - refreshes(time));
        for (let j = 0; j < repeats; j++)
            pushed.push({ time: time + (next - time) * j / repeats, values });
    }
    return pushed;
}

// A kick more than this long after its onset doesn't belong to it.
const WINDOW = 0.35;
// A kick may come this much before its onset: arrival timestamps jitter against the audio clock.
const SLACK = 0.03;
// cava can't show an onset sooner than this. Replaying the fixtures with a hair-trigger setting
// (threshold 0.1, 30-200 Hz), the earliest kick came 18 ms after its onset.
const MIN_LATENCY = 0.015;
// A shockwave this far behind the beat reads as off-beat.
export const LATE = 0.15;

// Score kick times against the true kick onsets (both in seconds, ascending). Returns the onsets
// that got no kick (missed), more than one (doubled) or a late first one (late), the kicks that
// belong to no onset (stray), and the median delay from onset to first kick (latency, or NaN).
export function score(onsets, kicks) {
    const perOnset = onsets.map(() => []);
    const stray = [];
    for (const kick of kicks) {
        // Each kick belongs to the latest onset at or before it...
        let i = -1;
        while (i + 1 < onsets.length && onsets[i + 1] <= kick + SLACK)
            i++;
        // ...unless cava couldn't have shown that onset yet, and the one before is still open.
        if (i > 0 && kick - onsets[i] < MIN_LATENCY && kick - onsets[i - 1] < WINDOW)
            i--;
        if (i >= 0 && kick - onsets[i] < WINDOW)
            perOnset[i].push(kick);
        else
            stray.push(kick);
    }
    const latencies = perOnset.map((own, i) => own.length ? own[0] - onsets[i] : NaN);
    return {
        missed: onsets.filter((_, i) => perOnset[i].length === 0),
        doubled: onsets.filter((_, i) => perOnset[i].length > 1),
        late: onsets.filter((_, i) => latencies[i] > LATE),
        stray,
        latency: median(latencies.filter(l => !Number.isNaN(l))),
    };
}

function median(xs) {
    if (!xs.length)
        return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// What a score() result exceeds of a budget { missed, doubled, stray, latency (ms) }, one line per
// symptom with the times it happened at; empty when it is within budget.
export function overBudget(result, budget) {
    const at = times => times.map(t => t.toFixed(2)).join(", ");
    const over = [];
    for (const [key, what] of [["missed", "onsets"], ["doubled", "onsets"], ["stray", "kicks"]]) {
        if (result[key].length > budget[key])
            over.push(`${key} ${result[key].length} > ${budget[key]} (${what} at ${at(result[key])} s)`);
    }
    const latency = Math.round(result.latency * 1000);
    if (!(latency <= budget.latency))
        over.push(`median latency ${latency} ms > ${budget.latency} ms`);
    return over;
}

// A table of score() results, one row per { name, onsets, kicks, result }, with a total row.
export function report(title, rows) {
    const cols = ["", "onsets", "kicks", "missed", "doubled", "stray", `late>${LATE * 1000}ms`, "latency p50"];
    const line = cells => cells.map((c, i) => i ? String(c).padStart(cols[i].length + 2) : String(c).padEnd(16)).join("");
    const sum = key => rows.reduce((n, r) => n + r.result[key].length, 0);
    const ms = s => Number.isNaN(s) ? "-" : `${Math.round(s * 1000)} ms`;
    return [
        title,
        line(cols),
        ...rows.map(({ name, onsets, kicks, result: r }) =>
            line([name, onsets, kicks, r.missed.length, r.doubled.length, r.stray.length, r.late.length, ms(r.latency)])),
        line(["total", rows.reduce((n, r) => n + r.onsets, 0), rows.reduce((n, r) => n + r.kicks, 0),
              sum("missed"), sum("doubled"), sum("stray"), sum("late"), ""]),
        `wrong kicks (missed + doubled + stray): ${sum("missed") + sum("doubled") + sum("stray")}`,
    ].join("\n");
}

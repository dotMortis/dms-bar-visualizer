// Replay recorded cava output through the kick detector and score its kicks against the true onsets.
// Shared by the replay tests: read a fixture, replay its frames, score the kicks, and report or
// check the result against a budget.
import fs from "node:fs";

import { createKickDetector } from "../docs/kick.mjs";

const BANDS = 32;

// A fixture recorded by fixtures/record.py: its JSON header (scenario, about, cava, onsets, ...)
// plus frames, [{ time, values }], parsed the way shell.qml parses cava's lines.
export function readFixture(scenario) {
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

// Push frames through a detector with these kick settings; returns its kicks, [{ time, power }].
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

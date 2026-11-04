// The live demo (docs/index.html, its logic in docs/demo.mjs) shows either the Bar Visualizer or
// the Lock Ring, on the same inputs and sliders. In the Lock Ring view the sliders are the
// plugin's settings (docs/lock-ring/settings.mjs), and the ring runs on them exactly as DMS
// stores them.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULTS, pluginSettings, ringSettings, settingText, slidersFor, viewFromHash } from "../docs/demo.mjs";

const keys = view => slidersFor(view).map(s => s.key);

describe("demo views", () => {
    test("opens on the Bar Visualizer, and on the Lock Ring with #ring", () => {
        assert.equal(viewFromHash(""), "bar");
        assert.equal(viewFromHash("#ring"), "ring");
        assert.equal(viewFromHash("#bar"), "bar");
        assert.equal(viewFromHash("#nonsense"), "bar");
    });

    test("the bar view has every bar tweakable, geometry included", () => {
        assert.deepEqual(keys("bar"), ["intensity", "speed", "kickThreshold", "kickDecay", "kickLowHz", "kickHighHz",
            "kickCooldown", "bassStretch", "barThickness", "spacing", "radius"]);
    });

    test("the ring view has the plugin's settings and the ring's size, but no bar geometry", () => {
        assert.deepEqual(keys("ring"), ["intensity", "speed", "kickThreshold", "kickDecay", "kickLowHz", "kickHighHz",
            "kickCooldown", "bassStretch", "handWaves", "ringSize"]);
    });

    // Both views tune one set of values, so a tweak carries over when switching.
    test("a slider both views share has the same range and step in each", () => {
        const bar = new Map(slidersFor("bar").map(s => [s.key, s]));
        for (const s of slidersFor("ring").filter(s => bar.has(s.key)))
            assert.deepEqual(s, { ...bar.get(s.key), hint: s.hint }, s.key);
    });

    test("every slider starts at its default, inside its range", () => {
        for (const view of ["bar", "ring"])
            for (const { key, min, max } of slidersFor(view))
                assert.ok(min <= DEFAULTS[key] && DEFAULTS[key] <= max, `${view} ${key}: ${DEFAULTS[key]}`);
    });
});

describe("ring sliders as plugin settings", () => {
    test("at the defaults, the sliders are what DMS stores for a fresh Lock Ring", () => {
        assert.deepEqual(pluginSettings(DEFAULTS), {
            intensity: 100, speed: 100, kickThreshold: 40, kickDecay: 60,
            kickLowHz: 20, kickHighHz: 90, kickCooldown: 100, bassStretch: 140, handWaves: 100,
        });
    });

    test("only the plugin's settings are stored, not the ring's size or the bar's geometry", () => {
        const stored = pluginSettings({ ...DEFAULTS, ringSize: 500, barThickness: 60 });
        assert.equal("ringSize" in stored, false);
        assert.equal("barThickness" in stored, false);
    });

    // The ring runs on what DMS would store, so every value a slider can take must survive it.
    test("every slider stop reaches the ring unchanged", () => {
        for (const { key, min, max, step } of slidersFor("ring").filter(s => s.key !== "ringSize")) {
            for (let i = 0; min + i * step <= max + 1e-9; i++) {
                const value = Number((min + i * step).toFixed(6));
                assert.equal(ringSettings({ ...DEFAULTS, [key]: value })[key], value, `${key} at ${value}`);
            }
        }
    });

    test("a slider reads like the plugin's settings page", () => {
        assert.equal(settingText("kickThreshold", 0.4), "40 %");
        assert.equal(settingText("kickCooldown", 0.25), "250 ms");
        assert.equal(settingText("kickLowHz", 30), "30 Hz");
        assert.equal(settingText("kickDecay", 8.5), "85");
        assert.equal(settingText("ringSize", 360), "360 px");
    });
});

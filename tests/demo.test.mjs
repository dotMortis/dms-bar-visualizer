// The live demo (docs/index.html, its logic in docs/demo.mjs) shows either the Bar Visualizer or
// the Lock Ring, on the same inputs and sliders. In the Lock Ring view the sliders are the shared
// settings, as config.json has them (docs/config.mjs), and the plugin's own settings
// (docs/lock-ring/settings.mjs), which the ring runs on exactly as DMS stores them.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { DEFAULTS as SHARED } from "../docs/config.mjs";
import { SETTINGS } from "../docs/lock-ring/settings.mjs";
import { DEFAULTS, pluginSettings, ringSettings, ringSide, settingText, slidersFor, viewFromHash } from "../docs/demo.mjs";

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

    test("the ring view has the shared settings and the plugin's own, but no bar geometry", () => {
        assert.deepEqual(keys("ring"), ["intensity", "speed", "kickThreshold", "kickDecay", "kickLowHz", "kickHighHz",
            "kickCooldown", "bassStretch", "handWaves", "ringSize"]);
    });

    // Both views tune one set of values, so a tweak carries over when switching.
    test("a slider both views share has the same range and step in each", () => {
        const bar = new Map(slidersFor("bar").map(s => [s.key, s]));
        for (const s of slidersFor("ring").filter(s => bar.has(s.key)))
            assert.deepEqual(s, { ...bar.get(s.key), hint: s.hint }, s.key);
    });

    test("the sliders start at the shared defaults and the plugin's", () => {
        for (const s of SETTINGS)
            assert.equal(DEFAULTS[s.key], s.default, s.key);
        for (const [key, value] of Object.entries(SHARED))
            assert.equal(DEFAULTS[key], value, key);
    });

    test("every slider starts at its default, inside its range", () => {
        for (const view of ["bar", "ring"])
            for (const { key, min, max } of slidersFor(view))
                assert.ok(min <= DEFAULTS[key] && DEFAULTS[key] <= max, `${view} ${key}: ${DEFAULTS[key]}`);
    });
});

describe("ring sliders as plugin settings", () => {
    test("at the defaults, the sliders are what DMS stores for a fresh Lock Ring", () => {
        assert.deepEqual(pluginSettings(DEFAULTS), { handWaves: 100, ringSize: 40 });
    });

    // The shared ones are config.json's (ADR 0004).
    test("only the plugin's own settings are stored, not the shared ones, the bar's geometry or the 12h/24h toggle", () => {
        const stored = pluginSettings({ ...DEFAULTS, barThickness: 60, use24Hour: false });
        assert.deepEqual(Object.keys(stored), ["handWaves", "ringSize"]);
    });

    test("the ring runs on the shared settings as they are", () => {
        const s = ringSettings({ ...DEFAULTS, kickLowHz: 35, intensity: 1.35 });
        assert.equal(s.kickLowHz, 35);
        assert.equal(s.intensity, 1.35);
        assert.equal(s.ringSize, 0.4);
    });

    // The ring runs on what DMS would store, so every value a slider can take must survive it.
    test("every slider stop reaches the ring unchanged", () => {
        for (const { key, min, max, step } of slidersFor("ring")) {
            for (let i = 0; min + i * step <= max + 1e-9; i++) {
                const value = Number((min + i * step).toFixed(6));
                assert.equal(ringSettings({ ...DEFAULTS, [key]: value })[key], value, `${key} at ${value}`);
            }
        }
    });

    test("the plugin's own sliders read like its settings page, the shared ones like config.json", () => {
        assert.equal(settingText("ringSize", 0.4), "40 %");
        assert.equal(settingText("handWaves", 1.5), "150 %");
        assert.equal(settingText("kickThreshold", 0.4), "0.4");
        assert.equal(settingText("kickLowHz", 30), "30");
    });
});

// The ring size setting sizes the widget from the screen's height; the demo's page stands in for
// the screen.
describe("ring size in the demo", () => {
    test("the widget is the ring size's share of the page height, like the plugin's of the screen", () => {
        assert.equal(ringSide(0.4, 1920, 1080), 432);
        assert.equal(ringSide(0.8, 1920, 1080), 864);
    });

    test("and stays inside a narrow page", () => {
        assert.equal(ringSide(0.8, 400, 1080), 376);
    });
});

// The live demo (docs/index.html, its logic in docs/demo.mjs) shows either the Bar Visualizer or
// the Lock Ring, on the same inputs and sliders. Both views tune one set of values shaped like
// config.json (docs/config.mjs), which "Export config.json" downloads as they are.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { DEFAULTS, parseConfig } from "../docs/config.mjs";
import {
    BANDS, HIGH_HZ, LOW_HZ, coreKind, coreSettings, defaults, localSeconds, ringSide, setValueAt, slidersFor, timeHitOf,
    valueAt, viewFromHash,
} from "../docs/demo.mjs";
import { TIME_HIT, timeHit } from "../lock-ring/clock.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

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

    test("the ring view has the shared settings and the Lock Ring's section, but no bar geometry", () => {
        assert.deepEqual(keys("ring"), ["intensity", "speed", "kickThreshold", "kickDecay", "kickLowHz", "kickHighHz",
            "kickCooldown", "bassStretch", "lockRing.handWaves", "lockRing.ringSize", "lockRing.intensityPercent",
            "lockRing.kickLowHzPercent", "lockRing.kickHighHzPercent", "lockRing.kickThresholdPercent",
            "lockRing.kickCooldownPercent"]);
    });

    test("the ring view's percentages go from 0 to 300 %", () => {
        for (const s of slidersFor("ring").filter(s => s.key.endsWith("Percent")))
            assert.deepEqual([s.min, s.max], [0, 300], s.key);
    });

    // Both views tune one set of values, so a tweak carries over when switching.
    test("a slider both views share is the same in each", () => {
        const bar = new Map(slidersFor("bar").map(s => [s.key, s]));
        for (const s of slidersFor("ring").filter(s => bar.has(s.key)))
            assert.deepEqual(s, bar.get(s.key), s.key);
    });

    test("every slider starts at its default, inside its range", () => {
        for (const view of ["bar", "ring"])
            for (const { key, min, max } of slidersFor(view)) {
                const value = valueAt(defaults(), key);
                assert.ok(min <= value && value <= max, `${view} ${key}: ${value}`);
            }
    });
});

describe("demo values", () => {
    test("start as config.json's defaults, in a copy the sliders can change", () => {
        const values = defaults();
        assert.deepEqual(values, DEFAULTS);
        setValueAt(values, "lockRing.ringSize", 0.6);
        setValueAt(values, "intensity", 1.3);
        assert.equal(values.lockRing.ringSize, 0.6);
        assert.equal(values.intensity, 1.3);
        assert.equal(DEFAULTS.lockRing.ringSize, 0.4);
        assert.equal(DEFAULTS.intensity, 1.0);
    });

    // What "Export config.json" downloads is what both visualizers then read.
    test("exported, they read back as the same settings", () => {
        const values = defaults();
        setValueAt(values, "lockRing.handWaves", 1.5);
        setValueAt(values, "kickLowHz", 35);
        assert.deepEqual(parseConfig(JSON.stringify(values)), values);
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

// The page hands the core (docs/wasm/, src/wasm.rs) config.json's text for the view it shows.
describe("the core's settings in the demo", () => {
    test("both views run on the sliders' values as they are", () => {
        const values = defaults();
        setValueAt(values, "kickThreshold", 0.3);
        setValueAt(values, "lockRing.kickThresholdPercent", 50);
        assert.deepEqual(JSON.parse(coreSettings(values)), values);
    });

    // The core applies the Lock Ring's percentages itself (core/tests/lock_ring_settings.rs).
    test("the ring view selects the Lock Ring kind, the bar view the bar's", () => {
        assert.equal(coreKind("ring"), "lock-ring");
        assert.equal(coreKind("bar"), "bar");
    });

    test("the Digital Time's hit, from the core's lockRing(), is shaped as clock.mjs timeHit() gives it", () => {
        const want = timeHit(0.6);
        const ring = {
            timeCopyOffsets: Float64Array.from(want.copies, c => c.offset), timeCopyOpacity: want.copies[0].opacity,
            timeGlowOpacity: want.glow.opacity, timeGlowScale: want.glow.scale, timeWhite: want.white,
        };
        assert.deepEqual(timeHitOf(ring, TIME_HIT.split.map(([color]) => color)), want);
    });

    test("the Hands' local time is the seconds since local midnight", () => {
        assert.equal(localSeconds(new Date(2026, 10, 4, 9, 30, 15, 500)), 9 * 3600 + 30 * 60 + 15.5);
        assert.equal(localSeconds(new Date(2026, 10, 4, 0, 0, 0, 0)), 0);
    });

    test("the page selects the kind after configuring, whenever either changes", () => {
        const page = fs.readFileSync(path.join(ROOT, "docs/index.html"), "utf8");
        assert.match(page, /core\.configure\(coreSettings\(cfg\)\);\s*core\.setKind\(coreKind\(view\)\);/);
        assert.doesNotMatch(page, /lockRingSettings/, "no percentages applied in the page");
    });
});

describe("the demo's bands", () => {
    test("are laid out as cava's: 32 from 30 Hz to 14 kHz", () => {
        assert.deepEqual({ BANDS, LOW_HZ, HIGH_HZ }, { BANDS: 32, LOW_HZ: 30, HIGH_HZ: 14000 });
    });
});

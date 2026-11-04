// The Lock Ring's own settings (lock-ring/settings.mjs): one plugin-wide set in DMS's plugin
// settings, stored as the integers DMS's SliderSetting keeps (ADR 0002). The settings the bar has
// too come from the bar's config.json instead (docs/config.mjs, tests/config.test.mjs, ADR 0004).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { DEFAULTS as SHARED } from "../docs/config.mjs";
import { PLUGIN_ID, SETTINGS, isPluginWide, resolve, sliderOf } from "../lock-ring/settings.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

describe("lock ring settings", () => {
    test("with nothing stored, every setting is at its default", () => {
        assert.deepEqual(resolve({}), { handWaves: 1.0, ringSize: 0.4 });
    });

    test("only the hands' wave strength and the ring's size are the Lock Ring's own", () => {
        assert.deepEqual(SETTINGS.map(s => s.key), ["handWaves", "ringSize"]);
    });

    // One place to tune them: config.json, for both visualizers.
    test("none of them is one the Bar Visualizer has too", () => {
        for (const { key } of SETTINGS)
            assert.equal(key in SHARED, false, key);
    });

    // Spec #10's "ring size": the widget's default size, as a share of the screen height.
    test("ring size reads back as a share of the screen height, 20 % to 80 %", () => {
        const ringSize = SETTINGS.find(s => s.key === "ringSize");
        assert.deepEqual(sliderOf(ringSize), {
            settingKey: "ringSize", label: "Ring size", description: ringSize.description,
            defaultValue: 40, minimum: 20, maximum: 80, unit: "%",
        });
        assert.equal(resolve({ ringSize: 65 }).ringSize, 0.65);
    });

    test("the widget's default size follows the ring size setting live, and stays resizable", () => {
        const ring = fs.readFileSync(path.join(ROOT, "lock-ring/LockRing.qml"), "utf8");
        assert.match(ring, /defaultWidth: Math\.round\(\(screen\?\.height \?\? 1080\) \* LockAudio\.ringSize\)/);
        assert.match(ring, /defaultHeight: defaultWidth/);
        assert.doesNotMatch(ring, /^    (width|height):/m, "DMS sets the widget's size, so a resize sticks");
        const audio = fs.readFileSync(path.join(ROOT, "lock-ring/LockAudio.qml"), "utf8");
        assert.match(audio, /readonly property real ringSize: settings\.ringSize/);
    });

    test("wave strength reads back from its slider, 0 = straight hands", () => {
        assert.equal(resolve({ handWaves: 0 }).handWaves, 0);
        assert.equal(resolve({ handWaves: 150 }).handWaves, 1.5);
    });

    test("broken stored values fall back to the default", () => {
        const s = resolve({ handWaves: "40", ringSize: NaN });
        assert.equal(s.handWaves, 1.0);
        assert.equal(s.ringSize, 0.4);
    });

    // Settings the plugin stored before they moved to config.json are left alone, not read.
    test("stored values of settings it no longer has are ignored", () => {
        assert.deepEqual(resolve({ kickLowHz: 30, intensity: 150, ringSize: 50 }), { handWaves: 1.0, ringSize: 0.5 });
    });

    test("each slider starts at the default and reads back as it", () => {
        for (const setting of SETTINGS) {
            const slider = sliderOf(setting);
            for (const v of [slider.defaultValue, slider.minimum, slider.maximum])
                assert.ok(Number.isInteger(v), `${setting.key}: ${v} is an integer`);
            assert.ok(slider.minimum <= slider.defaultValue && slider.defaultValue <= slider.maximum, setting.key);
            assert.equal(resolve({ [setting.key]: slider.defaultValue })[setting.key], setting.default, setting.key);
        }
    });

    // DMS stores desktop-plugin settings per widget, but all rings share one capture, so the
    // tweakables live once for the plugin; DMS's own per-widget keys stay per widget.
    test("the tweakables are stored plugin-wide, DMS's display choice per widget", () => {
        for (const setting of SETTINGS)
            assert.ok(isPluginWide(setting.key), setting.key);
        assert.equal(isPluginWide("displayPreferences"), false);
    });

    test("the settings are filed under the plugin's id", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "lock-ring/plugin.json"), "utf8"));
        assert.equal(PLUGIN_ID, manifest.id);
    });
});

// The Lock Ring's settings (lock-ring/settings.mjs): one plugin-wide set in DMS's plugin settings,
// at the Bar Visualizer's defaults, stored as the integers DMS's SliderSetting keeps (ADR 0002).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { PLUGIN_ID, SETTINGS, isPluginWide, resolve, sliderOf } from "../lock-ring/settings.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

// The numbers in a QML `defaults: ({ ... })` block, by key.
function qmlDefaults(file) {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");
    const block = text.match(/defaults:\s*\(\{([\s\S]*?)\}\)/)[1];
    return Object.fromEntries([...block.matchAll(/(\w+):\s*(-?[\d.]+)/g)].map(([, k, v]) => [k, Number(v)]));
}

describe("lock ring settings", () => {
    test("with nothing stored, every setting is at the Bar Visualizer's default", () => {
        assert.deepEqual(resolve({}), {
            intensity: 1.0,
            speed: 1.0,
            kickThreshold: 0.4,
            kickDecay: 6.0,
            kickLowHz: 20,
            kickHighHz: 90,
            kickCooldown: 0.1,
            bassStretch: 1.4,
            handWaves: 1.0,
        });
    });

    // The Lock Ring's own settings (the hands) have no Bar Visualizer counterpart.
    const shared = SETTINGS.filter(s => !s.lockOnly);

    test("the defaults are the ones in shell.qml and the audio pipeline", () => {
        const bar = { ...qmlDefaults("shell.qml"), ...qmlDefaults("audio/AudioPipeline.qml") };
        const defaults = resolve({});
        for (const { key } of shared)
            assert.equal(defaults[key], bar[key], key);
    });

    test("only the hands' wave strength is the Lock Ring's own", () => {
        assert.deepEqual(SETTINGS.filter(s => s.lockOnly).map(s => s.key), ["handWaves"]);
    });

    test("wave strength reads back from its slider, 0 = straight hands", () => {
        assert.equal(resolve({ handWaves: 0 }).handWaves, 0);
        assert.equal(resolve({ handWaves: 150 }).handWaves, 1.5);
    });

    // What SliderSetting saves: kickThreshold 25 %, kickCooldown 250 ms, bassStretch 200 %.
    test("stored slider integers read back in the units the pipeline and shader use", () => {
        const s = resolve({ kickThreshold: 25, kickCooldown: 250, kickDecay: 85, kickLowHz: 30, bassStretch: 200, intensity: 150 });
        assert.equal(s.kickThreshold, 0.25);
        assert.equal(s.kickCooldown, 0.25);
        assert.equal(s.kickDecay, 8.5);
        assert.equal(s.kickLowHz, 30);
        assert.equal(s.bassStretch, 2);
        assert.equal(s.intensity, 1.5);
        assert.equal(s.speed, 1.0, "an untouched setting stays at its default");
    });

    test("a cooldown of 0 means no limit, not the default", () => {
        assert.equal(resolve({ kickCooldown: 0 }).kickCooldown, 0);
    });

    test("broken stored values fall back to the default", () => {
        const s = resolve({ kickThreshold: "40", kickDecay: null, speed: NaN, kickHighHz: Infinity });
        assert.equal(s.kickThreshold, 0.4);
        assert.equal(s.kickDecay, 6.0);
        assert.equal(s.speed, 1.0);
        assert.equal(s.kickHighHz, 90);
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

    // The slider ranges are the demo's (docs/index.html SLIDERS), so a value tuned there fits here.
    // The Lock Ring's own settings too, once the demo has them.
    test("the slider ranges are the demo's", () => {
        const html = fs.readFileSync(path.join(ROOT, "docs/index.html"), "utf8");
        for (const setting of SETTINGS) {
            const found = html.match(new RegExp(`\\["${setting.key}",\\s*([\\d.]+),\\s*([\\d.]+)`));
            if (!found && setting.lockOnly)
                continue;
            const [, min, max] = found;
            assert.deepEqual([setting.min, setting.max], [Number(min), Number(max)], setting.key);
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

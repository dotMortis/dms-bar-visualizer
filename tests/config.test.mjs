// The one config file for both visualizers (docs/config.mjs): ~/.config/bar-visualizer/config.json,
// the Bar Visualizer's settings at the top level and the Lock Ring's own in its lockRing section.
// Its defaults are defined once; the bar and the Lock Ring both read it (ADR 0004).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { DEFAULTS, configDir, configPath, parseConfig } from "../docs/config.mjs";
import { slidersFor, valueAt } from "../docs/demo.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const code = file => read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("config.json", () => {
    test("has the bar's geometry, the look and audio settings, and the Lock Ring's own, at their defaults", () => {
        assert.deepEqual(DEFAULTS, {
            barThickness: 40, spacing: 4, radius: 12, followMaximize: true,
            intensity: 1.0, speed: 1.0, kickThreshold: 0.4, kickDecay: 6.0,
            kickLowHz: 20, kickHighHz: 90, kickCooldown: 0.1, bassStretch: 1.4,
            lockRing: { handWaves: 1.0, ringSize: 0.4 },
        });
    });

    test("lives in ~/.config/bar-visualizer/, or under XDG_CONFIG_HOME", () => {
        assert.equal(configPath("", "/home/u"), "/home/u/.config/bar-visualizer/config.json");
        assert.equal(configPath(undefined, "/home/u"), "/home/u/.config/bar-visualizer/config.json");
        assert.equal(configPath("/x/conf", "/home/u"), "/x/conf/bar-visualizer/config.json");
        assert.equal(configDir("/x/conf", "/home/u"), "/x/conf/bar-visualizer");
    });

    test("is read over the defaults, a missing key at its default", () => {
        assert.deepEqual(parseConfig('{"kickLowHz": 35, "intensity": 1.5}'), { ...DEFAULTS, kickLowHz: 35, intensity: 1.5 });
        assert.deepEqual(parseConfig("{}"), DEFAULTS);
    });

    test("a value of the wrong type, or not finite, gets the default", () => {
        assert.deepEqual(parseConfig('{"kickLowHz": "35", "speed": null, "kickDecay": true, "followMaximize": 0}'), DEFAULTS);
    });

    test("keys without a default are dropped", () => {
        const c = parseConfig('{"barThickness": 48, "junk": 1, "lockRing": {"ringSize": 0.5, "junk": 2}}');
        assert.equal(c.barThickness, 48);
        assert.equal("junk" in c, false);
        assert.deepEqual(c.lockRing, { handWaves: 1.0, ringSize: 0.5 });
    });

    // An older config.json, written before the Lock Ring had a section in it, has none.
    test("the lockRing section is read key by key; missing or not an object, it's the defaults", () => {
        assert.deepEqual(parseConfig('{"lockRing": {"handWaves": 1.5}}').lockRing, { handWaves: 1.5, ringSize: 0.4 });
        for (const section of ["", ', "lockRing": 3', ', "lockRing": null', ', "lockRing": [1]'])
            assert.deepEqual(parseConfig(`{"speed": 1.2${section}}`).lockRing, DEFAULTS.lockRing, section);
    });

    test("a fresh copy each time, so a change can't leak into the defaults", () => {
        parseConfig("{}").lockRing.ringSize = 0.7;
        assert.equal(DEFAULTS.lockRing.ringSize, 0.4);
    });

    test("broken JSON throws, so a half-written file keeps the last good settings", () => {
        assert.throws(() => parseConfig('{"kickLowHz": 3'));
    });

    test("defaults defined once: the bar, the audio pipeline and the Lock Ring take them from here", () => {
        assert.match(read("shell.qml"), /^import "docs\/config\.mjs" as Config$/m);
        assert.match(read("shell.qml"), /readonly property var defaults: Config\.DEFAULTS$/m);
        assert.match(read("audio/AudioPipeline.qml"), /readonly property var defaults: Config\.DEFAULTS$/m);
        assert.match(read("lock-ring/LockAudio.qml"), /property var settings: Config\.DEFAULTS$/m);
        for (const file of ["shell.qml", "audio/AudioPipeline.qml", "lock-ring/LockAudio.qml"]) {
            assert.doesNotMatch(code(file), /(kickLowHz|barThickness|ringSize):\s*\d/, `${file} has its own default`);
            assert.doesNotMatch(code(file), /\/\.config|\/config\.json/, `${file} builds the config path itself`);
        }
    });

    test("every number in it has a slider in the demo, inside its range", () => {
        const sliders = new Map([...slidersFor("bar"), ...slidersFor("ring")].map(s => [s.key, s]));
        const keys = [...Object.keys(DEFAULTS).filter(k => typeof DEFAULTS[k] === "number"),
            ...Object.keys(DEFAULTS.lockRing).map(k => `lockRing.${k}`)];
        for (const key of keys) {
            const s = sliders.get(key), value = valueAt(DEFAULTS, key);
            assert.ok(s && s.min <= value && value <= s.max, key);
        }
    });
});

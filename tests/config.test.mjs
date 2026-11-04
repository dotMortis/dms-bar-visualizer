// The one config file for both visualizers (docs/config.mjs): ~/.config/bar-visualizer/config.json,
// the Bar Visualizer's settings at the top level and the Lock Ring's own in its lockRing section.
// Its defaults are defined once; the bar and the Lock Ring both read it (ADR 0004).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { DEFAULTS, configDir, configPath, lockRingSettings, parseConfig } from "../docs/config.mjs";
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
            lockRing: {
                handWaves: 1.0, ringSize: 0.4, intensityPercent: 100, kickLowHzPercent: 100,
                kickHighHzPercent: 100, kickThresholdPercent: 100, kickCooldownPercent: 100,
            },
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
        assert.deepEqual(c.lockRing, Object.assign({}, DEFAULTS.lockRing, { ringSize: 0.5 }));
    });

    // An older config.json, written before the Lock Ring had a section in it, has none.
    test("the lockRing section is read key by key; missing or not an object, it's the defaults", () => {
        assert.deepEqual(parseConfig('{"lockRing": {"handWaves": 1.5}}').lockRing, Object.assign({}, DEFAULTS.lockRing, { handWaves: 1.5 }));
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

// The Lock Ring tunes five of the bar's settings as percentages of them, so they keep following the
// bar (ADR 0005). Its own capture and Kick detector run on the result.
describe("the Lock Ring's settings", () => {
    const ringOf = json => lockRingSettings(parseConfig(json));

    test("at 100 % they are the bar's", () => {
        assert.deepEqual(lockRingSettings(DEFAULTS), DEFAULTS);
        const bar = parseConfig('{"intensity": 1.3, "kickLowHz": 40, "kickThreshold": 0.3}');
        assert.deepEqual(lockRingSettings(bar), bar);
    });

    test("each percentage scales its base setting", () => {
        const r = ringOf(`{"intensity": 1.2, "kickLowHz": 40, "kickHighHz": 100, "kickThreshold": 0.4, "kickCooldown": 0.2,
            "lockRing": {"intensityPercent": 150, "kickLowHzPercent": 50, "kickHighHzPercent": 200,
                         "kickThresholdPercent": 75, "kickCooldownPercent": 0}}`);
        assert.ok(Math.abs(r.intensity - 1.8) < 1e-9);
        assert.equal(r.kickLowHz, 20);
        assert.equal(r.kickHighHz, 200);
        assert.ok(Math.abs(r.kickThreshold - 0.3) < 1e-9);
        assert.equal(r.kickCooldown, 0);
    });

    test("they follow the bar: retuning the base retunes the ring", () => {
        const pct = '"lockRing": {"intensityPercent": 200}';
        assert.equal(ringOf(`{"intensity": 0.5, ${pct}}`).intensity, 1);
        assert.equal(ringOf(`{"intensity": 0.8, ${pct}}`).intensity, 1.6);
    });

    test("the other settings stay the bar's", () => {
        const r = ringOf('{"speed": 1.5, "kickDecay": 9, "bassStretch": 2, "lockRing": {"intensityPercent": 50, "kickThresholdPercent": 50}}');
        assert.equal(r.speed, 1.5);
        assert.equal(r.kickDecay, 9);
        assert.equal(r.bassStretch, 2);
        assert.deepEqual(r.lockRing, Object.assign({}, DEFAULTS.lockRing, { intensityPercent: 50, kickThresholdPercent: 50 }));
    });

    test("a negative percentage counts as 0; there is no upper limit", () => {
        const r = ringOf('{"lockRing": {"intensityPercent": -50, "kickThresholdPercent": 1000}}');
        assert.equal(r.intensity, 0);
        assert.equal(r.kickThreshold, 4);
    });

    test("a cooldown of 0 stays 0, whatever its percentage", () => {
        assert.equal(ringOf('{"kickCooldown": 0, "lockRing": {"kickCooldownPercent": 300}}').kickCooldown, 0);
    });

    test("a fresh copy: the bar's settings are left as they are", () => {
        const bar = parseConfig('{"lockRing": {"intensityPercent": 150}}');
        lockRingSettings(bar);
        assert.equal(bar.intensity, 1);
        assert.equal(DEFAULTS.intensity, 1);
    });

    test("the Lock Ring runs its capture and its look on them", () => {
        const audio = code("lock-ring/LockAudio.qml");
        assert.match(audio, /readonly property var ringSettings: Config\.lockRingSettings\(settings\)/);
        assert.match(audio, /readonly property real intensity: ringSettings\.intensity/);
        assert.match(audio, /settings: root\.ringSettings/);
    });
});

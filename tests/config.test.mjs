// The settings both visualizers share (docs/config.mjs): defined once, read from the Bar
// Visualizer's config.json by the bar and the Lock Ring alike (ADR 0004).
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { DEFAULTS, configPath, parseConfig } from "../docs/config.mjs";
import { slidersFor } from "../docs/demo.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("shared settings", () => {
    test("are the look, speed and kick settings, at their defaults", () => {
        assert.deepEqual(DEFAULTS, {
            intensity: 1.0, speed: 1.0, kickThreshold: 0.4, kickDecay: 6.0,
            kickLowHz: 20, kickHighHz: 90, kickCooldown: 0.1, bassStretch: 1.4,
        });
    });

    test("live in ~/.config/bar-visualizer/config.json, or under XDG_CONFIG_HOME", () => {
        assert.equal(configPath("", "/home/u"), "/home/u/.config/bar-visualizer/config.json");
        assert.equal(configPath(undefined, "/home/u"), "/home/u/.config/bar-visualizer/config.json");
        assert.equal(configPath("/x/conf", "/home/u"), "/x/conf/bar-visualizer/config.json");
    });

    test("read from config.json over the defaults, a missing key at its default", () => {
        assert.deepEqual(parseConfig('{"kickLowHz": 35, "intensity": 1.5}'), { ...DEFAULTS, kickLowHz: 35, intensity: 1.5 });
        assert.deepEqual(parseConfig("{}"), DEFAULTS);
    });

    test("a value of the wrong type, or not finite, gets the default", () => {
        assert.deepEqual(parseConfig('{"kickLowHz": "35", "speed": null, "kickDecay": true}'), DEFAULTS);
    });

    test("keys without a default are dropped, other defaults can be passed", () => {
        const bar = { barThickness: 40, followMaximize: true, ...DEFAULTS };
        assert.deepEqual(parseConfig('{"barThickness": 48, "followMaximize": false, "junk": 1}', bar),
            { ...bar, barThickness: 48, followMaximize: false });
        assert.equal("junk" in parseConfig('{"junk": 1}'), false);
    });

    test("broken JSON throws, so a half-written file keeps the last good settings", () => {
        assert.throws(() => parseConfig('{"kickLowHz": 3'));
    });

    test("are defined once: the bar, the audio pipeline and the Lock Ring take them from here", () => {
        assert.match(read("shell.qml"), /^import "docs\/config\.mjs" as Config$/m);
        assert.match(read("shell.qml"), /\}, Config\.DEFAULTS\)/);
        assert.match(read("audio/AudioPipeline.qml"), /readonly property var defaults: Config\.DEFAULTS$/m);
        assert.match(read("lock-ring/LockAudio.qml"), /property var shared: Config\.DEFAULTS$/m);
        for (const file of ["shell.qml", "audio/AudioPipeline.qml", "lock-ring/LockAudio.qml"])
            assert.doesNotMatch(read(file), /kickLowHz:\s*\d/, `${file} has its own kickLowHz default`);
    });

    test("every one has a slider in the demo, inside its range", () => {
        const sliders = new Map(slidersFor("bar").map(s => [s.key, s]));
        for (const [key, value] of Object.entries(DEFAULTS)) {
            const s = sliders.get(key);
            assert.ok(s && s.min <= value && value <= s.max, key);
        }
    });
});

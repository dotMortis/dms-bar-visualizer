// The Bar Ribbons' numbers live once, in docs/bar-ribbons.mjs. The shader can't import them, so
// shaders/viz.frag and the demo's port of it in docs/index.html repeat them. These checks keep both
// copies on their source, like tests/lock-constants.test.mjs does for the Lock Ring.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { LEVEL, RIBBON, SHAKE, SHOCK } from "../docs/bar-ribbons.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

// The demo's port: the GLSL in index.html's FRAG template string.
function demoFrag() {
    const html = read("docs/index.html");
    const start = html.indexOf("const FRAG = `");
    return html.slice(start, html.indexOf("`;", start));
}

// A shader's `const float NAME = number;` lines.
function shaderConstants(source) {
    const values = {};
    for (const [, name, value] of source.matchAll(/^const float (\w+) = ([\d.]+);/gm))
        values[name] = Number(value);
    return values;
}

// RIBBON.freqStep is RIBBON_FREQ_STEP in the shader.
const constName = (group, key) => `${group}_${key.replace(/[A-Z]/g, c => `_${c}`).toUpperCase()}`;

const SHADERS = { "shaders/viz.frag": read("shaders/viz.frag"), "docs/index.html": demoFrag() };
const GROUPS = { RIBBON, LEVEL, SHOCK, SHAKE };

for (const [file, source] of Object.entries(SHADERS)) {
    describe(`${file}'s Ribbon constants match docs/bar-ribbons.mjs`, () => {
        const frag = shaderConstants(source);
        for (const [group, values] of Object.entries(GROUPS)) {
            test(group, () => {
                for (const [key, value] of Object.entries(values)) {
                    const name = constName(group, key);
                    assert.ok(name in frag, `${file} defines ${name}`);
                    assert.ok(Math.abs(frag[name] - value) < 1e-9, `${name}: ${file} has ${frag[name]}, the module ${value}`);
                }
            });
        }

        // The numbers are only mirrored if the shader uses the constants, not its own copies.
        test("draws the Ribbons from the constants", () => {
            const code = source.replace(/\/\/.*$/gm, "").replace(/^const float .*$/gm, "");
            for (const [group, values] of Object.entries(GROUPS))
                for (const key of Object.keys(values))
                    assert.match(code, new RegExp(`\\b${constName(group, key)}\\b`), `${file} uses ${constName(group, key)}`);
            for (const literal of ["2.6", "2.1", "2.3", "0.42", "4.5", "2.2", "0.003", "97.0", "83.0"])
                assert.ok(!new RegExp(`(?<![\\d.])${literal.replace(".", "\\.")}(?![\\d])`).test(code), `${file} spells out ${literal}`);
        });
    });
}

describe("the Bar Visualizer loads the Ribbon shape", () => {
    // So Qt's JS engine is held to it (tests/qml-modules.test.mjs), and what rides the Ribbons can.
    test("shell.qml imports docs/bar-ribbons.mjs", () => {
        assert.match(read("shell.qml"), /^import "docs\/bar-ribbons\.mjs" as \w+$/m);
    });
});

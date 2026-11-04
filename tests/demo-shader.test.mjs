// The demo draws the Lock Ring with the plugin's own shader: docs/webgl.mjs turns ring.frag (Qt's
// Vulkan-style GLSL 450) into GLSL ES 3.00 for WebGL2 when the page loads, so there's no port to
// keep in sync.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { ringUniforms } from "../docs/demo.mjs";
import { toWebGL } from "../docs/webgl.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const RING_FRAG = fs.readFileSync(path.join(ROOT, "docs/lock-ring/ring.frag"), "utf8");

// The uniforms LockRing.qml's ShaderEffect sets: its `property ... name:` lines.
function pluginUniforms() {
    const qml = fs.readFileSync(path.join(ROOT, "lock-ring/LockRing.qml"), "utf8");
    const effect = qml.slice(qml.indexOf("ShaderEffect {"));
    const body = effect.slice(0, effect.indexOf("\n        }"));
    return [...body.matchAll(/^\s*property\s+\w+\s+(\w+):/gm)].map(([, name]) => name);
}

const glslang = (() => {
    try {
        execFileSync("glslangValidator", ["--version"], { stdio: "ignore" });
        return true;
    } catch {
        return false;
    }
})();

describe("ring shader in the demo", () => {
    test("comes out as GLSL ES 3.00, with plain uniforms instead of Qt's uniform block", () => {
        const { source } = toWebGL(RING_FRAG);
        assert.match(source, /^#version 300 es\n/);
        assert.match(source, /^precision highp float;$/m);
        assert.doesNotMatch(source, /ubuf|layout\s*\(|uniform\s+buf/);
        assert.match(source, /^in vec2 qt_TexCoord0;$/m);
        assert.match(source, /^out vec4 fragColor;$/m);
    });

    test("lists every uniform the plugin sets, with its type", () => {
        const { uniforms } = toWebGL(RING_FRAG);
        const byName = new Map(uniforms.map(u => [u.name, u.type]));
        const names = pluginUniforms();
        assert.ok(names.includes("swell") && names.includes("b7"), `found the plugin's uniforms: ${names}`);
        for (const name of names)
            assert.ok(byName.has(name), `${name} is a uniform`);
        assert.equal(byName.get("time"), "float");
        assert.equal(byName.get("b0"), "vec4");
        assert.equal(byName.get("qt_Opacity"), "float");
    });

    test("turns a small block-style shader into plain uniforms", () => {
        const { source, uniforms } = toWebGL(`#version 450
layout(location = 0) in vec2 qt_TexCoord0;
layout(location = 0) out vec4 fragColor;
layout(std140, binding = 0) uniform buf {
    mat4 qt_Matrix;
    float qt_Opacity;
    float level;        // 0..1
    vec4 a0; vec4 a1;   // two quads
} ubuf;
void main() { fragColor = vec4(ubuf.level) * ubuf.a0 * ubuf.qt_Opacity; }
`);
        assert.deepEqual(uniforms, [
            { type: "mat4", name: "qt_Matrix" }, { type: "float", name: "qt_Opacity" },
            { type: "float", name: "level" }, { type: "vec4", name: "a0" }, { type: "vec4", name: "a1" },
        ]);
        assert.match(source, /^uniform float level;$/m);
        assert.match(source, /fragColor = vec4\(level\) \* a0 \* qt_Opacity;/);
    });

    test("compiles as a GLSL ES fragment shader", { skip: !glslang && "glslangValidator isn't installed" }, () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ring-es-"));
        try {
            const file = path.join(dir, "ring.frag");
            fs.writeFileSync(file, toWebGL(RING_FRAG).source);
            execFileSync("glslangValidator", [file], { stdio: "pipe" });
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

// The page sets the ring shader's uniforms from the same state LockRing.qml binds them to.
describe("ring uniforms in the demo", () => {
    const state = {
        values: Array.from({ length: 32 }, (_, i) => i / 31), time: 1300, flow: 2, treble: 0.3,
        swell: 0.05, presence: 1, intensity: 1.2, bassStretch: 1.4,
        kickAges: [0.5, 9], kickPowers: [0.8, 1], kickSeeds: [3, 4],
    };

    test("sets every uniform the plugin sets, and no others", () => {
        assert.deepEqual(Object.keys(ringUniforms(state)).sort(), pluginUniforms().sort());
    });

    test("the bands go in quads, bass first", () => {
        const u = ringUniforms(state);
        assert.deepEqual(u.b0, [0, 1 / 31, 2 / 31, 3 / 31]);
        assert.deepEqual(u.b7, [28 / 31, 29 / 31, 30 / 31, 1]);
    });

    test("kicks fill the shader's slots, a played-out kick and missing ones empty", () => {
        const u = ringUniforms(state);
        assert.deepEqual(u.kickPower0, [0.8, 0, 0, 0]);
        assert.deepEqual(u.kickAge0.slice(0, 1), [0.5]);
        assert.deepEqual(u.kickSeed0, [3, 0, 0, 0]);
        assert.deepEqual(u.kickPower1, [0, 0, 0, 0]);
    });

    test("time wraps at 1200 s like the plugin's, and the dial is the plugin's", () => {
        const u = ringUniforms(state);
        assert.ok(Math.abs(u.time - 100) < 1e-9, `time ${u.time}`);
        assert.ok(Math.abs(u.dial - 0.68) < 1e-9, `dial ${u.dial}`);
    });
});

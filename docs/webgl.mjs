// Turns a Qt Quick ShaderEffect fragment shader (Vulkan-style GLSL 450, as qsb compiles it) into
// GLSL ES 3.00 for WebGL2, so the demo runs the Lock Ring's own lock-ring/shaders/ring.frag
// instead of a port. Qt's uniform block becomes plain uniforms of the same names. Plain JS for
// tests/demo-shader.test.mjs; docs/index.html imports it.

// { source, uniforms: [{ type, name }] } for the GLSL 450 fragment shader `src`.
export function toWebGL(src) {
    const block = src.match(/layout\s*\([^)]*\)\s*uniform\s+\w+\s*\{([\s\S]*?)\}\s*(\w+)\s*;/);
    if (!block)
        throw new Error("no uniform block");
    const [whole, body, instance] = block;
    const uniforms = [...body.replace(/\/\/.*$/gm, "").matchAll(/(\w+)\s+(\w+)\s*;/g)]
        .map(([, type, name]) => ({ type, name }));
    const source = src
        .replace(/^#version .*$/m, "#version 300 es\nprecision highp float;\nprecision highp int;")
        .replace(whole, uniforms.map(u => `uniform ${u.type} ${u.name};`).join("\n"))
        .replace(/layout\s*\(\s*location\s*=\s*\d+\s*\)\s*(in|out)\b/g, "$1")
        .replace(new RegExp(`\\b${instance}\\.`, "g"), "");
    return { source, uniforms };
}

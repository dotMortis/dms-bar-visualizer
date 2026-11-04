// The Lock Ring ships as the DMS desktop plugin in lock-ring/ (ADR 0001). DMS finds it through
// plugin.json, and the dir gets symlinked into the plugin folder, where QML resolves relative
// imports on the symlink's path: everything the plugin imports has to sit inside lock-ring/.
// Shared files (the audio pipeline, the kick detector) get there as relative symlinks, which a
// package resolves by copying with cp -L.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN = path.join(ROOT, "lock-ring");
const manifest = () => JSON.parse(fs.readFileSync(path.join(PLUGIN, "plugin.json"), "utf8"));

// Every file the plugin loads, as paths relative to `dir` (lock-ring/ or a copy of it): the QML
// files at its top, and everything those and the files they reach import by a quoted path (QML
// `import "x"`, JS `import ... from "x"`, a directory's QML files). Resolved the way QML does it: on the path as written,
// not through symlinks. A path that leaves `dir` starts with "..". `file` is who imports it.
function importGraph(dir) {
    const found = new Map();
    const visit = (target, file) => {
        if (found.has(target))
            return;
        found.set(target, file);
        const full = path.join(dir, target);
        if (target.startsWith("..") || !fs.existsSync(full))
            return;
        // A directory import brings in its QML components.
        if (fs.statSync(full).isDirectory()) {
            for (const f of fs.readdirSync(full).filter(f => f.endsWith(".qml")))
                visit(path.join(target, f), target);
            return;
        }
        const pattern = target.endsWith(".qml")
            ? /^\s*import\s+"([^"]+)"/gm
            : /^\s*import\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gm;
        for (const [, quoted] of fs.readFileSync(full, "utf8").matchAll(pattern))
            visit(path.normalize(path.join(path.dirname(target), quoted)), target);
    };
    for (const entry of fs.readdirSync(dir).filter(f => f.endsWith(".qml")))
        visit(entry, null);
    return [...found].map(([target, file]) => ({ file, target }));
}

// Every import the plugin makes stays inside `dir` and resolves to a file there.
function assertSelfContained(dir) {
    const imports = importGraph(dir).filter(i => i.file);
    assert.ok(imports.length > 0, "the component imports clock.mjs");
    for (const { file, target } of imports) {
        assert.ok(!target.startsWith(".."), `${file} imports ${target}, outside the plugin dir`);
        assert.ok(fs.existsSync(path.join(dir, target)), `${file} imports ${target}, which doesn't exist`);
    }
}

const copies = [];
after(() => copies.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

describe("lock ring plugin", () => {
    test("plugin.json declares the lockRing desktop widget", () => {
        const m = manifest();
        for (const key of ["id", "name", "description", "version", "author", "type", "capabilities", "component"])
            assert.ok(m[key], `plugin.json has ${key}`);
        assert.equal(m.id, "lockRing");
        assert.equal(m.type, "desktop");
        assert.ok(m.capabilities.includes("desktop-widget"), "listed in Settings -> Lock Screen");
    });

    test("the component plugin.json names exists in the plugin dir", () => {
        const component = path.normalize(manifest().component);
        assert.ok(!component.startsWith(".."), component);
        assert.ok(fs.existsSync(path.join(PLUGIN, component)), component);
    });

    test("every import stays inside the plugin dir and exists", () => {
        assertSelfContained(PLUGIN);
    });

    // The pacman package copies lock-ring/ with its symlinks resolved into
    // /etc/xdg/quickshell/dms-plugins/lockRing.
    test("a copy with its symlinks resolved (cp -L), as a package makes it, still finds every import", () => {
        const copy = fs.mkdtempSync(path.join(os.tmpdir(), "lockRing-"));
        copies.push(copy);
        execFileSync("cp", ["-rL", `${PLUGIN}/.`, copy]);
        assertSelfContained(copy);
    });

    // Bundled, not forked: what the plugin loads is the repo's own audio pipeline and kick
    // detector, the ones the Bar Visualizer uses.
    test("the plugin runs the shared audio pipeline and kick detector", () => {
        const loaded = importGraph(PLUGIN).map(i => fs.realpathSync(path.join(PLUGIN, i.target)));
        for (const shared of ["audio/AudioPipeline.qml", "docs/kick.mjs"])
            assert.ok(loaded.includes(fs.realpathSync(path.join(ROOT, shared))), `the plugin loads ${shared}`);
    });

    // Relative links into the repo work from any checkout, and cp -L can resolve them.
    test("every symlink in the plugin dir is relative and points into the repo", () => {
        for (const entry of fs.readdirSync(PLUGIN, { recursive: true })) {
            const full = path.join(PLUGIN, entry);
            if (!fs.lstatSync(full).isSymbolicLink())
                continue;
            const target = fs.readlinkSync(full);
            assert.ok(!path.isAbsolute(target), `${entry} -> ${target} is absolute`);
            const real = path.relative(fs.realpathSync(ROOT), fs.realpathSync(full));
            assert.ok(!real.startsWith(".."), `${entry} -> ${target} leaves the repo`);
        }
    });

    // With a qmldir, a directory's QML types are only the ones it lists (and a pragma Singleton
    // only becomes one shared instance when listed there).
    test("qmldir lists every QML type in the plugin dir", () => {
        const listed = new Set(fs.readFileSync(path.join(PLUGIN, "qmldir"), "utf8")
            .split("\n").map(line => line.trim().split(/\s+/).at(-1)).filter(f => f?.endsWith(".qml")));
        for (const file of fs.readdirSync(PLUGIN).filter(f => f.endsWith(".qml")))
            assert.ok(listed.has(file), `qmldir lists ${file}`);
    });

    test("the shared audio is a singleton, so every ring on every monitor uses one capture", () => {
        const qmldir = fs.readFileSync(path.join(PLUGIN, "qmldir"), "utf8");
        assert.match(qmldir, /^singleton LockAudio \S+ LockAudio\.qml$/m);
        assert.match(fs.readFileSync(path.join(PLUGIN, "LockAudio.qml"), "utf8"), /^pragma Singleton$/m);
    });
});

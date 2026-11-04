// The Lock Ring ships as the DMS desktop plugin in lock-ring/ (ADR 0001). DMS finds it through
// plugin.json, and the dir gets symlinked into the plugin folder, where QML resolves relative
// imports on the symlink's path: everything the plugin imports has to sit inside lock-ring/.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const PLUGIN = path.resolve(import.meta.dirname, "..", "lock-ring");
const manifest = () => JSON.parse(fs.readFileSync(path.join(PLUGIN, "plugin.json"), "utf8"));

// The plugin's QML files, and every file and dir they import by a quoted path, as paths relative
// to lock-ring/. A path that leaves lock-ring/ starts with "..".
function quotedImports() {
    const found = [];
    const visit = dir => {
        for (const entry of fs.readdirSync(path.join(PLUGIN, dir), { withFileTypes: true })) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory() && !entry.isSymbolicLink())
                visit(file);
            else if (entry.name.endsWith(".qml"))
                for (const [, quoted] of fs.readFileSync(path.join(PLUGIN, file), "utf8").matchAll(/^\s*import\s+"([^"]+)"/gm))
                    found.push({ file, target: path.normalize(path.join(dir, quoted)) });
        }
    };
    visit(".");
    return found;
}

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

    test("every quoted import stays inside the plugin dir and exists", () => {
        const imports = quotedImports();
        assert.ok(imports.length > 0, "the component imports clock.mjs");
        for (const { file, target } of imports) {
            assert.ok(!target.startsWith(".."), `${file} imports ${target}, outside lock-ring/`);
            assert.ok(fs.existsSync(path.join(PLUGIN, target)), `${file} imports ${target}, which doesn't exist`);
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
});

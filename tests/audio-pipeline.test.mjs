// The audio pipeline (Active Player, capture, bands, Kicks, wave phase) is one component that both
// the Bar Visualizer and the Lock Ring use. These tests read the QML import graph: the component
// has to bundle on its own, and every file the Bar Visualizer loads has to be packaged.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PIPELINE = "audio/AudioPipeline.qml";

// The repo files a QML file pulls in: its quoted imports (a .mjs/.js file, or a directory of QML
// components), following those components' own imports. Module imports (QtQuick, Quickshell.*) are
// listed separately, by name.
function importGraph(entry) {
    const files = new Set(), modules = new Set();
    const visit = file => {
        if (files.has(file))
            return;
        files.add(file);
        if (!file.endsWith(".qml"))
            return;
        const dir = path.dirname(file);
        for (const [, quoted, module] of read(file).matchAll(/^\s*import\s+(?:"([^"]+)"|([\w.]+))/gm)) {
            if (module) {
                modules.add(module);
                continue;
            }
            const target = path.normalize(path.join(dir, quoted));
            const full = path.join(ROOT, target);
            assert.ok(fs.existsSync(full), `${file} imports ${quoted}, which doesn't exist`);
            if (fs.statSync(full).isDirectory()) {
                for (const f of fs.readdirSync(full).filter(f => f.endsWith(".qml")).sort())
                    visit(path.join(target, f));
            } else {
                visit(target);
            }
        }
        // Components in the file's own directory need no import.
        for (const f of fs.readdirSync(path.join(ROOT, dir)).filter(f => f.endsWith(".qml"))) {
            const name = f.slice(0, -4);
            if (new RegExp(`(^|[^\\w.])${name}\\s*\\{`, "m").test(read(file)) && path.join(dir, f) !== file)
                visit(path.join(dir, f));
        }
    };
    visit(entry);
    return { files: [...files].sort(), modules: [...modules].sort() };
}

const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

describe("audio pipeline", () => {
    test("bundles with nothing but itself and the kick detector", () => {
        assert.deepEqual(importGraph(PIPELINE).files, [PIPELINE, "docs/kick.mjs"]);
    });

    test("knows nothing about the bar: no compositor, window or bar settings", () => {
        const { modules } = importGraph(PIPELINE);
        for (const barOnly of ["Quickshell.Hyprland", "Quickshell.Wayland"])
            assert.ok(!modules.includes(barOnly), `imports ${barOnly}`);
        const source = read(PIPELINE);
        for (const word of ["PanelWindow", "barThickness", "followMaximize", "config.json", "Hyprland"])
            assert.ok(!source.includes(word), `mentions ${word}`);
    });

    test("is what the Bar Visualizer captures audio with", () => {
        assert.ok(importGraph("shell.qml").files.includes(PIPELINE));
        // The capture itself lives only in the component.
        assert.ok(!read("shell.qml").includes("exec cava"), "shell.qml still runs cava itself");
    });
});

describe("packaging", () => {
    test("the Arch package installs every file the Bar Visualizer loads", () => {
        const pkgbuild = read("packaging/aur/dms-bar-visualizer-git/PKGBUILD");
        const installed = [...pkgbuild.matchAll(/install -Dm644 (\S+) "\$share\/\1"/g)].map(m => m[1]);
        const missing = importGraph("shell.qml").files.filter(f => !installed.includes(f));
        assert.deepEqual(missing, []);
    });
});

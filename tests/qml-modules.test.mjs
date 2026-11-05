// The QML files import .mjs modules that Qt's own JS engine parses, not node. Qt's parser lags
// node's: syntax node runs fine (object spread `{ ...x }`, for one) can make Qt refuse a module,
// and with it every component that imports it. DMS then drops the plugin from its widget list.
// So every module a QML file imports gets loaded here through Qt's engine.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");

const QML = ["qml6", "qml", "/usr/lib/qt6/bin/qml", "/usr/lib64/qt6/bin/qml", "/usr/libexec/qt6/qml"].find(
    (bin) => spawnSync(bin, ["--version"], { stdio: "ignore" }).status === 0,
);

function qmlFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory())
            return e.name === "node_modules" || e.name.startsWith(".") ? [] : qmlFiles(full);
        return e.name.endsWith(".qml") ? [full] : [];
    });
}

// Shared modules the visualizers are about to import: held to Qt's engine before their QML lands.
const UPCOMING = ["docs/lyric-words.mjs"];

// Every .mjs a QML file imports, resolved on the path as written (as QML does, not via symlinks).
function importedModules() {
    const modules = new Set(UPCOMING.map((rel) => path.join(ROOT, rel)));
    for (const file of [path.join(ROOT, "shell.qml"), ...qmlFiles(path.join(ROOT, "audio")), ...qmlFiles(path.join(ROOT, "lock-ring"))]) {
        for (const [, rel] of fs.readFileSync(file, "utf8").matchAll(/^import\s+"([^"]+\.m?js)"/gm))
            modules.add(path.resolve(path.dirname(file), rel));
    }
    return [...modules].sort();
}

// Loads `module` through Qt's engine; resolves to null, or to Qt's error.
function qtLoadError(module) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qml-modules-"));
    try {
        const wrapper = path.join(dir, "Wrapper.qml");
        fs.writeFileSync(wrapper, `import QtQuick\nimport "file://${module}" as M\nQtObject {}\n`);
        fs.writeFileSync(
            path.join(dir, "host.qml"),
            `import QtQuick
QtObject {
    Component.onCompleted: {
        const c = Qt.createComponent("file://${wrapper}");
        if (c.status === Component.Error) { console.warn("QTLOAD-FAIL " + c.errorString()); Qt.exit(1); }
        else Qt.exit(0);
    }
}
`,
        );
        const run = spawnSync(QML, [path.join(dir, "host.qml")], {
            encoding: "utf8",
            timeout: 20000,
            env: { ...process.env, QT_QPA_PLATFORM: "offscreen", QT_FORCE_STDERR_LOGGING: "1" },
        });
        if (run.status === 0)
            return null;
        return (run.stderr + run.stdout).trim() || `qml exited with ${run.status}`;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("modules the QML imports", { skip: !QML && "Qt's qml runner isn't installed" }, () => {
    test("finds the Lock Ring's and the Bar Visualizer's modules", () => {
        const rel = importedModules().map((m) => path.relative(ROOT, m));
        assert.ok(rel.includes("lock-ring/kicks.mjs"), rel.join(", "));
        assert.ok(rel.includes("docs/config.mjs"), rel.join(", "));
    });

    for (const module of importedModules()) {
        test(`Qt's JS engine loads ${path.relative(ROOT, module)}`, () => {
            assert.equal(qtLoadError(module), null);
        });
    }
});

// The bar's Lyric Words layer (lyrics/LyricWordsLayer.qml) run in Qt itself: its bindings only
// fail at runtime, as TypeErrors in the log, so it is loaded with a stub BarLyrics showing one row
// of two words and must log nothing of its own.
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

// A settled lead vocal's words() entry.
const entry = (key, text) => ({
    key, text, background: false, size: 1, brightness: 1, popIn: 1, pop: 0.4, dissolve: 0,
    spot: { on: "ribbon", ribbon: 1, x: 0.3, row: "hello world", before: key.endsWith(":0") ? "" : "hello " },
});

// Runs the layer for a few frames; resolves to everything Qt logged about lyrics/.
function layerLog() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lyric-words-layer-"));
    try {
        const words = [entry("0:0", "hello"), entry("0:1", "world")];
        const current = Object.fromEntries(words.map(w => [w.key, w]));
        const rows = words.map(w => `ListElement { wordId: "${w.key}"; text: "${w.text}"; ribbon: 1; spotX: 0.3; rowText: "${w.spot.row}"; rowBefore: "${w.spot.before}" }`);
        fs.writeFileSync(path.join(dir, "host.qml"), `import QtQuick
import "file://${path.join(ROOT, "lyrics")}"
Item {
    width: 800; height: 40
    QtObject {
        id: stub
        property var current: (${JSON.stringify(current)})
        property ListModel words: ListModel { ${rows.join("\n")} }
    }
    LyricWordsLayer {
        anchors.fill: parent
        lyrics: stub
        inputs: ({ width: 800, height: 40, values: Array(32).fill(0.5), time: 0, kick: 0, treble: 0, flow: 0, bassStretch: 1, kickAges: [], kickPowers: [] })
    }
    Timer { interval: 300; running: true; onTriggered: Qt.exit(0) }
}
`);
        const run = spawnSync(QML, [path.join(dir, "host.qml")], {
            encoding: "utf8",
            timeout: 20000,
            env: { ...process.env, QT_QPA_PLATFORM: "offscreen", QT_FORCE_STDERR_LOGGING: "1" },
        });
        return (run.stderr + run.stdout).split("\n").filter(l => l.includes("lyrics/") || l.includes("host.qml"));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("the bar's Lyric Words layer in Qt", { skip: !QML && "Qt's qml runner isn't installed" }, () => {
    test("draws a row of words without a runtime error", () => {
        assert.deepEqual(layerLog(), []);
    });
});

// The audio pipeline (Active Player, capture, bands, Kicks, wave phase) is one component that both
// the Bar Visualizer and the Lock Ring use. These tests read the QML import graph: the component
// has to bundle on its own, and every file the Bar Visualizer loads has to be packaged.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { BANDS } from "../docs/kick.mjs";

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
    test("bundles with nothing but itself, the kick detector and the shared settings", () => {
        assert.deepEqual(importGraph(PIPELINE).files, [PIPELINE, "docs/config.mjs", "docs/kick.mjs"]);
    });

    test("knows nothing about the bar: no compositor, window or bar settings", () => {
        const { modules } = importGraph(PIPELINE);
        for (const barOnly of ["Quickshell.Hyprland", "Quickshell.Wayland"])
            assert.ok(!modules.includes(barOnly), `imports ${barOnly}`);
        const source = read(PIPELINE);
        for (const word of ["PanelWindow", "barThickness", "followMaximize", "config.json", "Hyprland"])
            assert.ok(!source.includes(word), `mentions ${word}`);
    });

    test("parses its capture's lines only with the shared parser", () => {
        const source = read(PIPELINE);
        // Its lines become bands through docs/kick.mjs, as the replay tests parse the fixtures.
        assert.match(source, /Kick\.parseBands\(/);
        assert.ok(!source.includes("parseInt"), "the pipeline parses cava's lines itself");
    });

    test("is what the Bar Visualizer captures audio with", () => {
        assert.ok(importGraph("shell.qml").files.includes(PIPELINE));
        // The capture itself lives only in the component.
        assert.ok(!read("shell.qml").includes("exec cava"), "shell.qml still runs cava itself");
    });
});

// Runs the pipeline in a headless qs of its own (offscreen, its own runtime and config dirs, no
// session bus, the harness's stand-in pactl): `body` goes inside AudioPipeline { }, and qs runs until
// the shell quits or 15 s pass. Resolves to qs's log and the runtime dir.
const QS = spawnSync("qs", ["--version"], { stdio: "ignore" }).status === 0;
function runPipeline(body) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvh-ap."));
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, "shell.qml"), `import QtQuick
import Quickshell
import "file://${ROOT}/audio"
ShellRoot {
    AudioPipeline {
        confPath: Quickshell.env("XDG_RUNTIME_DIR") + "/cava.conf"
        ${body}
    }
    Timer { interval: 10000; running: true; onTriggered: Qt.quit() }
}
`);
    const env = { ...process.env, QT_QPA_PLATFORM: "offscreen", XDG_RUNTIME_DIR: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir,
        XDG_STATE_HOME: dir, XDG_DATA_HOME: dir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${dir}/no-bus`,
        PATH: `${path.join(ROOT, "harness", "bin")}:${process.env.PATH}`, HARNESS_PACTL: "/usr/bin/true", HARNESS_PLAYER: "none" };
    for (const k of ["WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DISPLAY"]) delete env[k];
    const run = spawnSync("qs", ["-p", path.join(dir, "shell.qml"), "--no-color"], { env, encoding: "utf8", timeout: 15000 });
    return { log: run.stdout + run.stderr, dir, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

describe("audio pipeline in qs", { skip: !QS && "needs Quickshell (qs)" }, () => {
    test("runs a host's captureCommand in place of cava, and takes only whole lines of bands from it", () => {
        // A line one band short (its last band empty), then a whole one: only the whole one is bands.
        const cut = "500;".repeat(BANDS - 1), whole = "1000;250;" + "0;".repeat(BANDS - 2);
        const { log, dir, done } = runPipeline(`
        captureCommand: ["sh", "-c", "printf '${cut}\\n${whole}\\n'; sleep 10"]
        onValuesChanged: if (values.some(v => v !== 0)) { console.log("BANDS " + JSON.stringify(values.slice(0, 3))); Qt.quit(); }`);
        try {
            assert.equal(log.match(/BANDS (.*)/)?.[1], "[1,0.25,0]", log);
            // The default command writes cava's config to confPath before it runs cava: it never ran.
            assert.ok(!fs.existsSync(path.join(dir, "cava.conf")), "cava's own command ran too");
        } finally {
            done();
        }
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

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
    test("bundles with nothing but itself, its Active Player choice, the kick detector and the shared settings", () => {
        assert.deepEqual(importGraph(PIPELINE).files, [PIPELINE, "audio/active-player.mjs", "docs/config.mjs", "docs/kick.mjs"]);
    });

    test("chooses the Active Player and the capture source only with the shared module", () => {
        // audio/active-player.mjs, which tests/active-player.test.mjs replays events through.
        const source = read(PIPELINE);
        assert.match(source, /Player\.chooseActivePlayer\(/);
        assert.match(source, /Player\.chooseSource\(/);
        assert.match(source, /Player\.rechecksSource\(/);
        for (const own of ["isPlaying", "corked", "application.name"])
            assert.ok(!source.includes(own), `the pipeline still chooses by ${own} itself`);
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
// the shell quits or `seconds` pass. `subscribe`, if given, is what `pactl subscribe` runs instead
// of the stand-in's (sh, its stdout is the subscription). Every pactl run is logged to pactl.log in
// the runtime dir, one line of arguments each. Resolves to qs's log, the runtime dir and the pactl
// runs.
const QS = spawnSync("qs", ["--version"], { stdio: "ignore" }).status === 0;
function runPipeline(body, { seconds = 10, subscribe } = {}) {
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
    Timer { interval: ${seconds * 1000}; running: true; onTriggered: Qt.quit() }
}
`);
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "pactl"), `#!/bin/sh
echo "$*" >> "$XDG_RUNTIME_DIR/pactl.log"
${subscribe ? `[ "$*" = subscribe ] && { ${subscribe}
}` : ""}
exec "${path.join(ROOT, "harness", "bin", "pactl")}" "$@"
`, { mode: 0o755 });
    const env = { ...process.env, QT_QPA_PLATFORM: "offscreen", XDG_RUNTIME_DIR: dir, XDG_CONFIG_HOME: dir, XDG_CACHE_HOME: dir,
        XDG_STATE_HOME: dir, XDG_DATA_HOME: dir, DBUS_SESSION_BUS_ADDRESS: `unix:path=${dir}/no-bus`,
        PATH: `${bin}:${path.join(ROOT, "harness", "bin")}:${process.env.PATH}`, HARNESS_PACTL: "/usr/bin/true", HARNESS_PLAYER: "none" };
    for (const k of ["WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DISPLAY"]) delete env[k];
    const run = spawnSync("qs", ["-p", path.join(dir, "shell.qml"), "--no-color"], { env, encoding: "utf8", timeout: (seconds + 5) * 1000 });
    const logged = path.join(dir, "pactl.log");
    const pactl = fs.existsSync(logged) ? fs.readFileSync(logged, "utf8").trim().split("\n") : [];
    return { log: run.stdout + run.stderr, dir, pactl, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// Follows the Active Player for `seconds` with a capture that does nothing; resolves to how often
// `pactl subscribe` ran and how often the source was checked (each check lists the sinks once).
function follow(seconds, subscribe) {
    const { log, pactl, done } = runPipeline(`captureCommand: ["sleep", "${seconds + 5}"]`, { seconds, subscribe });
    done();
    return { subscriptions: pactl.filter(a => a === "subscribe").length, checks: pactl.filter(a => a.endsWith("list sinks")).length, log };
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

describe("following the Active Player in qs", { skip: !QS && "needs Quickshell (qs)" }, () => {
    test("with nothing changing, starts one subscription and checks the source once, no polling", () => {
        const { subscriptions, checks, log } = follow(7, "exec sleep 30");
        assert.deepEqual({ subscriptions, checks }, { subscriptions: 1, checks: 1 }, log);
    });

    test("checks the source again as a stream or output changes, not as a client comes and goes", () => {
        const { subscriptions, checks, log } = follow(5, `sleep 1; echo "Event 'new' on client #24097"; echo "Event 'remove' on client #24097"
            sleep 1; echo "Event 'change' on sink-input #7"; exec sleep 30`);
        assert.deepEqual({ subscriptions, checks }, { subscriptions: 1, checks: 2 }, log);
    });

    test("restarts the subscription when it dies, and checks again for what it missed", () => {
        // The first subscription dies at once (the sound server restarting); the next one lives.
        const { subscriptions, checks, log } = follow(7, `[ "$(grep -c '^subscribe$' "$XDG_RUNTIME_DIR/pactl.log")" -gt 1 ] || exit 1
            exec sleep 30`);
        assert.deepEqual({ subscriptions, checks }, { subscriptions: 2, checks: 2 }, log);
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

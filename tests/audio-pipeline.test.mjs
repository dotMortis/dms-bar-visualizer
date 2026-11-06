// The audio pipeline (Active Player, capture, bands, Kicks, wave phase) is one component that both
// the Bar Visualizer and the Lock Ring use. These tests read the QML import graph: the component
// has to bundle on its own, and every file the Bar Visualizer loads has to be packaged.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
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
    test("bundles with nothing but itself, its Active Player choice, Silence, the kick detector and the shared settings", () => {
        assert.deepEqual(importGraph(PIPELINE).files,
            [PIPELINE, "audio/active-player.mjs", "audio/silence.mjs", "docs/config.mjs", "docs/kick.mjs"]);
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

    test("tells the Silence case and whether it captures only with the shared module", () => {
        // audio/silence.mjs, which tests/silence.test.mjs replays player events and band frames through.
        const source = read(PIPELINE);
        assert.match(source, /Silence\.capturing\(/);
        assert.match(source, /Silence\.createSilence\(/);
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

// Runs the pipeline in a headless qs of its own (offscreen, its own runtime and config dirs, the
// harness's stand-in pactl): `body` goes inside AudioPipeline { id: pipeline }, and qs runs until
// the shell quits or `seconds` pass. `player` is the stand-in Active Player's PlaybackStatus at
// start (harness/player, on a private session bus), or "none" for no session bus at all.
// `subscribe`, if given, is what `pactl subscribe` runs instead of the stand-in's (sh, its stdout is
// the subscription). Every pactl run is logged to pactl.log in the runtime dir, one line of
// arguments each. Resolves to qs's log, the runtime dir and the pactl runs.
const QS = spawnSync("qs", ["--version"], { stdio: "ignore" }).status === 0;
const have = cmd => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const BUS = have("dbus-daemon") && spawnSync("/usr/bin/python3", ["-I", "-c", "import dbus, gi.repository.GLib"]).status === 0;
async function runPipeline(body, { seconds = 10, subscribe, player = "none" } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bvh-ap."));
    fs.chmodSync(dir, 0o700);
    fs.writeFileSync(path.join(dir, "shell.qml"), `import QtQuick
import Quickshell
import "file://${ROOT}/audio"
ShellRoot {
    AudioPipeline {
        id: pipeline
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
        PATH: `${bin}:${path.join(ROOT, "harness", "bin")}:${process.env.PATH}`, HARNESS_PACTL: "/usr/bin/true", HARNESS_PLAYER: player };
    for (const k of ["WAYLAND_DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "DISPLAY"]) delete env[k];
    const stop = [];
    try {
        if (player !== "none") {
            const bus = spawn("dbus-daemon", [`--config-file=${ROOT}/harness/bus.conf`, "--print-address=1", "--nofork"]);
            stop.push(bus);
            env.DBUS_SESSION_BUS_ADDRESS = await new Promise((resolve, reject) => {
                bus.stdout.once("data", data => resolve(data.toString().trim()));
                bus.once("exit", code => reject(new Error(`dbus-daemon exited ${code}`)));
            });
            stop.push(spawn(path.join(ROOT, "harness", "player"), [], { env: { ...env, HARNESS_LOOP: "60" }, stdio: "ignore" }));
        }
        const qs = spawn("qs", ["-p", path.join(dir, "shell.qml"), "--no-color"], { env });
        let log = "";
        qs.stdout.on("data", d => log += d);
        qs.stderr.on("data", d => log += d);
        const timeout = setTimeout(() => qs.kill(), (seconds + 5) * 1000);
        await new Promise(resolve => qs.once("exit", resolve));
        clearTimeout(timeout);
        const logged = path.join(dir, "pactl.log");
        const pactl = fs.existsSync(logged) ? fs.readFileSync(logged, "utf8").trim().split("\n") : [];
        return { log, dir, pactl, done: () => fs.rmSync(dir, { recursive: true, force: true }) };
    } finally {
        for (const p of stop) p.kill();
    }
}

// Follows the Active Player for `seconds` with a capture that does nothing; resolves to how often
// `pactl subscribe` ran and how often the source was checked (each check lists the sinks once).
async function follow(seconds, subscribe) {
    const { log, pactl, done } = await runPipeline(`captureCommand: ["sleep", "${seconds + 5}"]`, { seconds, subscribe });
    done();
    return { subscriptions: pactl.filter(a => a === "subscribe").length, checks: pactl.filter(a => a.endsWith("list sinks")).length, log };
}

// The line printed when the pipeline's state is logged as `STATE silence=<case> capturing=<bool>`.
const state = log => log.match(/STATE (.*)/)?.[1];
// A body that logs the pipeline's state after `ms` and quits.
const stateAfter = ms => `
        Timer { interval: ${ms}; running: true; onTriggered: { console.log("STATE silence=" + pipeline.silence + " capturing=" + pipeline.capturing); Qt.quit(); } }`;
// A capture that marks its start in the runtime dir, then prints `lines` and waits.
const markedCapture = (lines = "") => `
        captureCommand: ["sh", "-c", "touch \\"$XDG_RUNTIME_DIR/captured\\"; printf '${lines}'; sleep 10"]`;

describe("audio pipeline in qs", { skip: !QS && "needs Quickshell (qs)" }, () => {
    test("runs a host's captureCommand in place of cava, and takes only whole lines of bands from it", { skip: !BUS && "needs dbus-daemon and python-dbus" }, async () => {
        // A line one band short (its last band empty), then a whole one: only the whole one is bands.
        const cut = "500;".repeat(BANDS - 1), whole = "1000;250;" + "0;".repeat(BANDS - 2);
        const { log, dir, done } = await runPipeline(`
        captureCommand: ["sh", "-c", "printf '${cut}\\n${whole}\\n'; sleep 10"]
        onValuesChanged: if (values.some(v => v !== 0)) { console.log("BANDS " + JSON.stringify(values.slice(0, 3))); Qt.quit(); }`, { player: "Playing" });
        try {
            assert.equal(log.match(/BANDS (.*)/)?.[1], "[1,0.25,0]", log);
            // The default command writes cava's config to confPath before it runs cava: it never ran.
            assert.ok(!fs.existsSync(path.join(dir, "cava.conf")), "cava's own command ran too");
        } finally {
            done();
        }
    });

    test("captures nothing without an Active Player: Silence, no-player", async () => {
        const { log, dir, done } = await runPipeline(markedCapture() + stateAfter(3000));
        try {
            assert.equal(state(log), "silence=no-player capturing=false", log);
            assert.ok(!fs.existsSync(path.join(dir, "captured")), "the capture ran");
        } finally {
            done();
        }
    });

    test("captures nothing while the Active Player is paused: Silence, paused", { skip: !BUS && "needs dbus-daemon and python-dbus" }, async () => {
        const { log, dir, done } = await runPipeline(markedCapture() + stateAfter(4500), { player: "Paused" });
        try {
            assert.equal(state(log), "silence=paused capturing=false", log);
            assert.ok(!fs.existsSync(path.join(dir, "captured")), "the capture ran");
        } finally {
            done();
        }
    });

    test("starts capturing by itself when the paused Active Player plays", { skip: !BUS && "needs dbus-daemon and python-dbus" }, async () => {
        const loud = "1000;".repeat(BANDS);
        const { log, done } = await runPipeline(`
        captureCommand: ["sh", "-c", "printf '${loud}\\n'; sleep 10"]
        onActivePlayerChanged: if (activePlayer) Qt.callLater(() => { console.log("FOUND silence=" + silence + " capturing=" + capturing); activePlayer.play(); })
        onValuesChanged: if (values[0] === 1) { console.log("STATE silence=" + silence + " capturing=" + capturing); Qt.quit(); }`, { player: "Paused" });
        try {
            assert.equal(log.match(/FOUND (.*)/)?.[1], "silence=paused capturing=false", log);
            assert.equal(state(log), "silence= capturing=true", log);
        } finally {
            done();
        }
    });

    test("keeps capturing while the Active Player plays silence: Silence, silent", { skip: !BUS && "needs dbus-daemon and python-dbus" }, async () => {
        // Zeros, then nothing, as cava's sleep_timer does.
        const { log, dir, done } = await runPipeline(markedCapture(`${"0;".repeat(BANDS)}\\n`.repeat(3)) + `
        onSilenceChanged: if (silence === "silent") { console.log("STATE silence=" + silence + " capturing=" + capturing); Qt.quit(); }`, { player: "Playing" });
        try {
            assert.equal(state(log), "silence=silent capturing=true", log);
            assert.ok(fs.existsSync(path.join(dir, "captured")), "the capture never ran");
        } finally {
            done();
        }
    });

    test("stops capturing when the Active Player pauses, the bands reading silent", { skip: !BUS && "needs dbus-daemon and python-dbus" }, async () => {
        const loud = "1000;".repeat(BANDS);
        const { log, done } = await runPipeline(`
        captureCommand: ["sh", "-c", "printf '${loud}\\n'; sleep 10"]
        onValuesChanged: if (values[0] === 1) { console.log("LOUD silence=" + silence); activePlayer.pause(); }
        onCapturingChanged: if (!capturing) { console.log("STATE silence=" + silence + " capturing=" + capturing + " max=" + Math.max(...values)); Qt.quit(); }`, { player: "Playing" });
        try {
            assert.equal(log.match(/LOUD (.*)/)?.[1], "silence=", log);
            assert.equal(state(log), "silence=paused capturing=false max=0", log);
        } finally {
            done();
        }
    });
});

describe("following the Active Player in qs", { skip: !QS && "needs Quickshell (qs)" }, () => {
    test("with nothing changing, starts one subscription and checks the source once, no polling", async () => {
        const { subscriptions, checks, log } = await follow(7, "exec sleep 30");
        assert.deepEqual({ subscriptions, checks }, { subscriptions: 1, checks: 1 }, log);
    });

    test("checks the source again as a stream or output changes, not as a client comes and goes", async () => {
        const { subscriptions, checks, log } = await follow(5, `sleep 1; echo "Event 'new' on client #24097"; echo "Event 'remove' on client #24097"
            sleep 1; echo "Event 'change' on sink-input #7"; exec sleep 30`);
        assert.deepEqual({ subscriptions, checks }, { subscriptions: 1, checks: 2 }, log);
    });

    test("restarts the subscription when it dies, and checks again for what it missed", async () => {
        // The first subscription dies at once (the sound server restarting); the next one lives.
        const { subscriptions, checks, log } = await follow(7, `[ "$(grep -c '^subscribe$' "$XDG_RUNTIME_DIR/pactl.log")" -gt 1 ] || exit 1
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

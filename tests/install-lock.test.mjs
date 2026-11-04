// install-lock.sh links lock-ring/ into the user's DMS plugin dir as lockRing, and --uninstall
// takes it out again. Neither touches the Bar Visualizer install. Runs the script against a
// throwaway XDG_CONFIG_HOME.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "install-lock.sh");
const PLUGIN = path.join(ROOT, "lock-ring");

const homes = [];
after(() => homes.forEach(home => fs.rmSync(home, { recursive: true, force: true })));

// A fresh config dir holding `dirs`, plus a Bar Visualizer install as install.sh leaves it.
function configHome(dirs = []) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "install-lock-"));
    homes.push(home);
    for (const dir of dirs)
        fs.mkdirSync(path.join(home, dir), { recursive: true });
    fs.mkdirSync(path.join(home, "quickshell"), { recursive: true });
    fs.symlinkSync(ROOT, path.join(home, "quickshell", "bar-visualizer"));
    fs.mkdirSync(path.join(home, "bar-visualizer"));
    fs.writeFileSync(path.join(home, "bar-visualizer", "config.json"), '{"intensity": 1.2}\n');
    return home;
}

function run(home, ...args) {
    return execFileSync("bash", [SCRIPT, ...args], {
        env: { ...process.env, XDG_CONFIG_HOME: home, HOME: home },
        encoding: "utf8",
    });
}

// Every path under `home` with what it is, so a before/after shows anything that changed.
function snapshot(home) {
    const out = {};
    const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name), rel = path.relative(home, full);
            if (entry.isSymbolicLink())
                out[rel] = `-> ${fs.readlinkSync(full)}`;
            else if (entry.isDirectory())
                visit(full);
            else
                out[rel] = fs.readFileSync(full, "utf8");
        }
    };
    visit(home);
    return out;
}

const link = (home, dir) => path.join(home, dir, "plugins", "lockRing");

describe("install-lock.sh", () => {
    test("links lock-ring/ into ~/.config/dms/plugins as lockRing", () => {
        const home = configHome(["dms"]);
        run(home);
        assert.equal(fs.realpathSync(link(home, "dms")), fs.realpathSync(PLUGIN));
        assert.ok(fs.existsSync(path.join(link(home, "dms"), "plugin.json")));
    });

    test("uses ~/.config/DankMaterialShell/plugins when only that exists (DMS 1.x)", () => {
        const home = configHome(["DankMaterialShell"]);
        run(home);
        assert.equal(fs.realpathSync(link(home, "DankMaterialShell")), fs.realpathSync(PLUGIN));
        assert.ok(!fs.existsSync(path.join(home, "dms")));
    });

    test("creates ~/.config/dms/plugins when DMS has no config yet", () => {
        const home = configHome();
        run(home);
        assert.equal(fs.realpathSync(link(home, "dms")), fs.realpathSync(PLUGIN));
    });

    // The .qsb is a build product (gitignored), so a fresh checkout has none.
    test("compiles the ring shader the plugin loads, and only that one", () => {
        const qsb = path.join(PLUGIN, "shaders", "ring.frag.qsb");
        const barQsb = path.join(ROOT, "shaders", "viz.frag.qsb");
        const barBefore = fs.existsSync(barQsb) ? fs.statSync(barQsb).mtimeMs : null;
        fs.rmSync(qsb, { force: true });
        run(configHome(["dms"]));
        assert.ok(fs.statSync(qsb).size > 0, "ring.frag.qsb");
        assert.equal(fs.existsSync(barQsb) ? fs.statSync(barQsb).mtimeMs : null, barBefore, "the bar's viz.frag.qsb");
    });

    test("installing twice leaves one link", () => {
        const home = configHome(["dms"]);
        run(home);
        const once = snapshot(home);
        run(home);
        assert.deepEqual(snapshot(home), once);
    });

    test("--uninstall removes the link and leaves the plugin dir and the rest alone", () => {
        const home = configHome(["dms/plugins/otherPlugin"]);
        const before = snapshot(home);
        run(home);
        run(home, "--uninstall");
        assert.ok(!fs.existsSync(link(home, "dms")));
        assert.ok(fs.existsSync(path.join(home, "dms", "plugins", "otherPlugin")));
        assert.deepEqual(snapshot(home), before);
    });

    test("--uninstall leaves a lockRing that isn't its link alone", () => {
        const home = configHome(["dms/plugins/lockRing"]);
        fs.writeFileSync(path.join(link(home, "dms"), "plugin.json"), "{}\n");
        const before = snapshot(home);
        run(home, "--uninstall");
        assert.deepEqual(snapshot(home), before);
    });

    test("installing and uninstalling never touch the Bar Visualizer install", () => {
        const home = configHome(["dms"]);
        const bar = () => Object.fromEntries(Object.entries(snapshot(home)).filter(([p]) => !p.startsWith("dms")));
        const before = bar();
        run(home);
        assert.deepEqual(bar(), before);
        run(home, "--uninstall");
        assert.deepEqual(bar(), before);
    });
});

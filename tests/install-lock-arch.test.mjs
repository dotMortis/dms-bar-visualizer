// install-lock-arch.sh builds and installs the pacman package dms-lock-visualizer-git from this
// checkout's PKGBUILD, and --uninstall removes that package, never the Bar Visualizer's. Runs the
// script with stand-ins for pacman, sudo and makepkg that only record what they're asked to do,
// against a throwaway XDG_CONFIG_HOME.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const SCRIPT = path.join(ROOT, "install-lock-arch.sh");
const LOCK = "dms-lock-visualizer-git", BAR = "dms-bar-visualizer-git";
const PACKAGING = path.join(ROOT, "packaging/aur", LOCK);

const temps = [];
after(() => temps.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

// Stand-ins: each logs its command line to $STUB_LOG. `pacman -Q` succeeds for the packages in
// $INSTALLED. makepkg also keeps a copy of the dir it builds in.
const STUBS = {
    pacman: `echo "pacman $*" >>"$STUB_LOG"
[[ $1 == -Q ]] && { [[ " $INSTALLED " == *" $2 "* ]]; exit; }
exit 0`,
    sudo: `[[ $1 == -n ]] && shift
echo "sudo $*" >>"$STUB_LOG"
[[ $1 == pacman ]] && { shift; exec pacman "$@"; }
exec "$@"`,
    makepkg: `echo "makepkg $*" >>"$STUB_LOG"
cp -r . "$STUB_LOG.build"`,
    curl: `echo "curl $*" >>"$STUB_LOG"; exit 1`,
};

function setup({ installed = [] } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "install-lock-arch-"));
    temps.push(dir);
    const bin = path.join(dir, "bin"), home = path.join(dir, "config");
    fs.mkdirSync(bin);
    for (const [name, body] of Object.entries(STUBS))
        fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
    // A Bar Visualizer install as install.sh leaves it.
    fs.mkdirSync(path.join(home, "quickshell"), { recursive: true });
    fs.symlinkSync(ROOT, path.join(home, "quickshell", "bar-visualizer"));
    fs.mkdirSync(path.join(home, "bar-visualizer"));
    fs.writeFileSync(path.join(home, "bar-visualizer", "config.json"), '{"intensity": 1.2}\n');
    const log = path.join(dir, "log");
    fs.writeFileSync(log, "");
    const run = (...args) => execFileSync("bash", [SCRIPT, ...args], {
        env: {
            ...process.env, PATH: `${bin}:${process.env.PATH}`, STUB_LOG: log,
            INSTALLED: installed.join(" "), XDG_CONFIG_HOME: home, HOME: dir,
        },
        encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const calls = () => fs.readFileSync(log, "utf8").split("\n").filter(Boolean);
    return { home, run, calls, built: `${log}.build` };
}

// Every path under `home` with what it is, so a before/after shows anything that changed. Links
// aren't followed: the Bar Visualizer link points at this checkout, which other test files change.
function snapshot(home) {
    const out = {};
    const visit = dir => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name), rel = path.relative(home, full);
            if (entry.isSymbolicLink())
                out[rel] = `-> ${fs.readlinkSync(full)}`;
            else if (entry.isDirectory()) {
                out[rel] = "dir";
                visit(full);
            } else
                out[rel] = fs.readFileSync(full, "utf8");
        }
    };
    visit(home);
    return out;
}

const userPlugin = home => path.join(home, "dms", "plugins", "lockRing");

describe("install-lock-arch.sh", () => {
    test("builds and installs the package from this checkout's PKGBUILD with makepkg", () => {
        const { run, calls, built } = setup();
        run();
        assert.ok(calls().some(c => /^makepkg .*--syncdeps.*--install/.test(c)), calls().join("\n"));
        for (const file of ["PKGBUILD", `${LOCK}.install`])
            assert.deepEqual(fs.readFileSync(path.join(built, file)), fs.readFileSync(path.join(PACKAGING, file)), file);
        assert.ok(!calls().some(c => c.startsWith("curl")), "downloads nothing from a checkout");
    });

    // A user plugin shadows the system plugin with the same id, so a leftover install-lock.sh link
    // would hide the package.
    test("removes an install-lock.sh link that would shadow the package", () => {
        const { home, run } = setup();
        fs.mkdirSync(path.dirname(userPlugin(home)), { recursive: true });
        fs.symlinkSync(path.join(ROOT, "lock-ring"), userPlugin(home));
        run();
        assert.ok(!fs.existsSync(userPlugin(home)) && !isLink(userPlugin(home)));
    });

    test("leaves a lockRing dir that isn't a link alone", () => {
        const { home, run } = setup();
        fs.mkdirSync(userPlugin(home), { recursive: true });
        fs.writeFileSync(path.join(userPlugin(home), "plugin.json"), "{}\n");
        const before = snapshot(home);
        run();
        assert.deepEqual(snapshot(home), before);
    });

    test("installing never touches the Bar Visualizer's package or install", () => {
        const { home, run, calls } = setup({ installed: [BAR] });
        const before = snapshot(home);
        run();
        assert.deepEqual(snapshot(home), before);
        assert.deepEqual(calls().filter(c => c.includes("bar-visualizer")), []);
    });

    for (const installed of [[LOCK], [LOCK, BAR]])
        test(`--uninstall removes only ${LOCK} (installed: ${installed.join(", ")})`, () => {
            const { home, run, calls } = setup({ installed });
            const before = snapshot(home);
            run("--uninstall");
            assert.deepEqual(calls().filter(c => /^pacman -R/.test(c)), [`pacman -R ${LOCK}`]);
            assert.deepEqual(calls().filter(c => c.includes("bar-visualizer")), []);
            assert.deepEqual(snapshot(home), before);
        });

    test("--uninstall does nothing when the package isn't installed", () => {
        const { run, calls } = setup({ installed: [BAR] });
        run("--uninstall");
        assert.deepEqual(calls().filter(c => /^pacman -R/.test(c)), []);
    });

    test("rejects an unknown option without doing anything", () => {
        const { run, calls } = setup();
        assert.throws(() => run("--bogus"));
        assert.deepEqual(calls(), []);
    });
});

function isLink(p) {
    try {
        return fs.lstatSync(p).isSymbolicLink();
    } catch {
        return false;
    }
}

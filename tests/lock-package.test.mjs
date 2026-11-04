// The Arch package dms-lock-visualizer-git puts the Lock Ring into DMS's system plugin dir,
// /etc/xdg/quickshell/dms-plugins/lockRing. It stands alone next to the Bar Visualizer's package:
// no file in common, no conflict, no dependency either way. Runs each PKGBUILD's build() and
// package() the way makepkg does, on a copy of this checkout, into throwaway pkgdirs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const PLUGIN = path.join(ROOT, "lock-ring");
const LOCK = "dms-lock-visualizer-git", BAR = "dms-bar-visualizer-git";
const SYSTEM_PLUGIN = "etc/xdg/quickshell/dms-plugins/lockRing";

const temps = [];
after(() => temps.forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));
const tempDir = name => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
    temps.push(dir);
    return dir;
};

// Builds and packages `pkg` from a copy of the checkout (makepkg's git clone of it), so nothing in
// the checkout changes. Returns the pkgdir.
function makePackage(pkg) {
    const srcdir = tempDir(`${pkg}-src`), pkgdir = tempDir(`${pkg}-pkg`);
    fs.cpSync(ROOT, path.join(srcdir, "dms-bar-visualizer"), {
        recursive: true, verbatimSymlinks: true, filter: src => path.basename(src) !== ".git",
    });
    execFileSync("bash", ["-euo", "pipefail", "-c",
        'source "$1"; srcdir="$2"; pkgdir="$3"; cd "$srcdir"; build; cd "$srcdir"; package',
        "_", path.join(ROOT, "packaging/aur", pkg, "PKGBUILD"), srcdir, pkgdir]);
    return pkgdir;
}

// A PKGBUILD's variables, read by bash.
function pkgbuildVars(pkg) {
    const out = execFileSync("bash", ["-c",
        'source "$1"; printf "%s\\n" "pkgname=$pkgname" "install=$install"; ' +
        'for v in depends makedepends optdepends provides conflicts replaces; do ' +
        'eval "printf \\"$v=%s\\\\n\\" \\"\\${$v[@]}\\""; done',
        "_", path.join(ROOT, "packaging/aur", pkg, "PKGBUILD")], { encoding: "utf8" });
    const vars = {};
    for (const line of out.split("\n").filter(Boolean)) {
        const [key, ...rest] = line.split("=");
        (vars[key] ??= []).push(rest.join("="));
    }
    return vars;
}

// Every file and symlink in a pkgdir (pacman owns those; directories can be shared).
function entries(pkgdir) {
    return fs.readdirSync(pkgdir, { recursive: true })
        .filter(rel => !fs.lstatSync(path.join(pkgdir, rel)).isDirectory())
        .sort();
}

let lock, bar;
before(() => {
    lock = makePackage(LOCK);
    bar = makePackage(BAR);
});

describe("Lock Ring Arch package", () => {
    test("puts the plugin into DMS's system plugin dir as lockRing", () => {
        const manifest = JSON.parse(fs.readFileSync(path.join(lock, SYSTEM_PLUGIN, "plugin.json"), "utf8"));
        assert.equal(manifest.id, "lockRing");
        assert.ok(fs.existsSync(path.join(lock, SYSTEM_PLUGIN, manifest.component)), manifest.component);
    });

    // lock-ring/ holds the shared audio pipeline and kick detector as symlinks into the repo; the
    // package has to carry the files themselves.
    test("installs every file in lock-ring/ as a real file with the same content", () => {
        const installed = path.join(lock, SYSTEM_PLUGIN);
        for (const rel of fs.readdirSync(PLUGIN, { recursive: true })) {
            const src = path.join(PLUGIN, rel), dst = path.join(installed, rel);
            if (fs.statSync(src).isDirectory())
                continue;
            assert.ok(fs.existsSync(dst), `${rel} is missing`);
            assert.ok(!fs.lstatSync(dst).isSymbolicLink(), `${rel} is a symlink`);
            assert.deepEqual(fs.readFileSync(dst), fs.readFileSync(src), `${rel} differs`);
        }
    });

    test("compiles the ring shader the plugin loads", () => {
        assert.ok(fs.statSync(path.join(lock, SYSTEM_PLUGIN, "shaders/ring.frag.qsb")).size > 0);
    });

    test("installs only the plugin, its license and its README", () => {
        const outside = entries(lock).filter(rel => !rel.startsWith(SYSTEM_PLUGIN + path.sep));
        assert.deepEqual(outside, [
            `usr/share/doc/dms-lock-visualizer/README.md`,
            `usr/share/licenses/${LOCK}/LICENSE`,
        ]);
    });
});

describe("Lock Ring and Bar Visualizer packages stay apart", () => {
    test("no file is in both packages", () => {
        const barFiles = new Set(entries(bar));
        assert.deepEqual(entries(lock).filter(rel => barFiles.has(rel)), []);
        // Nor does one package's file sit under a path the other owns (such as the bar's
        // /etc/xdg/quickshell/bar-visualizer link).
        for (const [a, b] of [[lock, bar], [bar, lock]]) {
            const owned = new Set(entries(b));
            for (const rel of entries(a))
                for (let dir = path.dirname(rel); dir !== "."; dir = path.dirname(dir))
                    assert.ok(!owned.has(dir), `${rel} lies under ${dir}, which the other package owns`);
        }
    });

    test("neither package conflicts with, replaces, provides or needs the other", () => {
        const names = [LOCK, BAR, "dms-lock-visualizer", "dms-bar-visualizer"];
        for (const [pkg, other] of [[LOCK, BAR], [BAR, LOCK]]) {
            const vars = pkgbuildVars(pkg);
            assert.equal(vars.pkgname[0], pkg);
            assert.ok(vars.depends.includes("quickshell"), "reads the PKGBUILD's arrays");
            const otherNames = names.filter(n => other.startsWith(n));
            for (const key of ["depends", "optdepends", "provides", "conflicts", "replaces"])
                for (const value of vars[key] ?? [])
                    assert.ok(!otherNames.includes(value.split(/[:<>=]/)[0].trim()), `${pkg} ${key} ${value}`);
        }
    });

    test("each package has its own install script", () => {
        assert.notEqual(pkgbuildVars(LOCK).install[0], pkgbuildVars(BAR).install[0]);
        assert.ok(fs.existsSync(path.join(ROOT, "packaging/aur", LOCK, pkgbuildVars(LOCK).install[0])));
    });
});

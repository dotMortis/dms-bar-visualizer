// The live demo (docs/index.html) is published by GitHub Pages, which serves only docs/ and
// doesn't follow symlinks. So every file the page loads has to be a real file inside docs/. The
// Lock Ring's look and settings live there too (docs/lock-ring/), and the plugin reaches them
// through relative symlinks, as it does docs/kick.mjs: one copy, loaded by the page and the plugin.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const DOCS = path.join(ROOT, "docs");

// Every file the page loads, relative to docs/: the module script's imports, the modules they
// import in turn, and the files it fetches by a quoted "./..." path.
function pageFiles() {
    const found = new Set();
    const visit = (file, text) => {
        const imports = [...text.matchAll(/^\s*import\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/gm)]
            .concat([...text.matchAll(/fetch\(\s*(?:new URL\()?\s*["'](\.[^"']+)["']/g)]);
        for (const [, quoted] of imports) {
            const target = path.normalize(path.join(path.dirname(file), quoted));
            if (found.has(target))
                continue;
            found.add(target);
            const full = path.join(DOCS, target);
            if (target.endsWith(".mjs") && fs.existsSync(full))
                visit(target, fs.readFileSync(full, "utf8"));
        }
    };
    visit("index.html", fs.readFileSync(path.join(DOCS, "index.html"), "utf8"));
    for (const file of fs.readdirSync(DOCS).filter(f => f.endsWith(".mjs")))
        visit(file, fs.readFileSync(path.join(DOCS, file), "utf8"));
    return [...found];
}

describe("demo publishing", () => {
    test("the page loads the Lock Ring's modules and shader", () => {
        const files = pageFiles();
        for (const f of ["kick.mjs", "lock-ring/ring.mjs", "lock-ring/kicks.mjs", "lock-ring/hands.mjs",
                         "lock-ring/clock.mjs", "lock-ring/settings.mjs", "lock-ring/ring.frag"])
            assert.ok(files.includes(f), `the page loads ${f} (got ${files.join(", ")})`);
    });

    test("everything the page loads is a real file inside docs/, not a symlink", () => {
        for (const f of pageFiles()) {
            assert.ok(!f.startsWith(".."), `${f} is outside docs/`);
            const full = path.join(DOCS, f);
            assert.ok(fs.existsSync(full), `${f} doesn't exist`);
            assert.ok(!fs.lstatSync(full).isSymbolicLink(), `${f} is a symlink, which Pages doesn't follow`);
        }
    });

    // Not forked: the plugin's files are links to the page's.
    test("the plugin loads the same files as the page", () => {
        const shared = {
            "lock-ring/docs/kick.mjs": "docs/kick.mjs",
            "lock-ring/ring.mjs": "docs/lock-ring/ring.mjs",
            "lock-ring/kicks.mjs": "docs/lock-ring/kicks.mjs",
            "lock-ring/hands.mjs": "docs/lock-ring/hands.mjs",
            "lock-ring/clock.mjs": "docs/lock-ring/clock.mjs",
            "lock-ring/settings.mjs": "docs/lock-ring/settings.mjs",
            "lock-ring/shaders/ring.frag": "docs/lock-ring/ring.frag",
        };
        for (const [plugin, page] of Object.entries(shared)) {
            assert.ok(fs.lstatSync(path.join(ROOT, plugin)).isSymbolicLink(), `${plugin} is a link`);
            assert.equal(fs.realpathSync(path.join(ROOT, plugin)), fs.realpathSync(path.join(ROOT, page)), plugin);
        }
    });
});

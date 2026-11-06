// The council round (docs/council.md): the brief every reviewer gets, and the tree they get with it.
// Each reviewer is given this repo's files, so nothing in them may say how their scores are used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const COUNCIL = fs.readFileSync(path.join(ROOT, "docs/council.md"), "utf8");

// The brief: the part of docs/council.md handed to each reviewer word for word, between its markers.
function brief() {
    const m = COUNCIL.match(/<!-- brief: begin -->\n([\s\S]*?)<!-- brief: end -->/);
    assert.ok(m, "docs/council.md has no brief between <!-- brief: begin --> and <!-- brief: end -->");
    return m[1];
}

// Every text file the council gets: what git tracks, plus what's on the way to being committed.
function trackedTexts() {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: ROOT, encoding: "utf8" })
        .split("\0").filter(Boolean);
    return files.flatMap(f => {
        const full = path.join(ROOT, f);
        if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return [];
        const bytes = fs.readFileSync(full);
        return bytes.includes(0) ? [] : [[f, bytes.toString("utf8")]];   // not binaries
    });
}

// The categories of #38, in its order.
const CATEGORIES = [
    "CPU in Silence",
    "CPU with music",
    "CPU with music and Lyric Words",
    "GPU cost",
    "Smoothness",
    "Faithful look",
    "Lock screen safety",
    "Code quality",
];

describe("the council round", () => {
    test("the brief asks for a score from 0 to 10 and a reason in each of the 8 categories, in order", () => {
        const text = brief();
        let at = -1;
        for (const c of CATEGORIES) {
            const i = text.indexOf(`**${c}**`);
            assert.ok(i > at, `the brief doesn't name "${c}" after the category before it`);
            at = i;
        }
        assert.match(text, /0 to 10/);
        assert.match(text, /reason/);
    });

    // The reviewers get the whole tree (docs/council.md, The evidence), so what is done with their
    // scores mustn't be in it. These are the ways the tree could give it away: the rule's
    // name, a count of all the scores, or a mark each score has to reach.
    test("nothing in the tree the council gets says what is done with their scores", () => {
        const tells = [
            /stop(ping)?[\s-]+rule/i,
            /\b(all|every|each)\s+(of\s+the\s+)?(24|twenty[\s-]four|3\s*[x×]\s*8)\s+scores?\b/i,
            /\bscor(e|es|ed|ing)\b[^.\n]{0,40}?\b\d+\s*(\/\s*10\s*)?(or|and)\s+(higher|above|more|better|up)\b/i,
            /\b\d+\s*(\/\s*10\s*)?(or|and)\s+(higher|above|up)\b[^.\n]{0,40}?\bscor(e|es|ed|ing)\b/i,
            /\bdissent(ing)?\s+scores?\b/i,
            /\bpass(es|ing)?\s+(mark|bar|threshold)\b/i,
        ];
        const found = [];
        for (const [file, text] of trackedTexts())
            for (const t of tells) {
                const m = text.match(t);
                if (m) found.push(`${file}: "${m[0]}"`);
            }
        assert.deepEqual(found, []);
    });
});

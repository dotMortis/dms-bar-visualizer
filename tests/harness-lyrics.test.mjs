// The replay harness's fixed timed lyrics (harness/lyrics.json), in place of DMS's: the Lyric Words
// they give over one loop of the reference track, through the shared Lyric Words module as the bar
// times them, and the stand-in DMS socket (harness/dms) that serves them, as the Bar Visualizer
// asks it (ADR 0006). The socket part is skipped without python3.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { createLyricWords } from "../docs/lyric-words.mjs";

const HARNESS = path.join(import.meta.dirname, "..", "harness");
const LYRICS = JSON.parse(fs.readFileSync(path.join(HARNESS, "lyrics.json"), "utf8"));
const LOOP = 24.05; // s, the reference track's loop (tests/harness-kicks.test.mjs)

const texts = words => words.map(w => w.text);

describe("the harness's timed lyrics", () => {
    // The bar's tracker, the track at its start at wall 0 and playing, as the stand-in player reports it.
    const bar = () => {
        const tracker = createLyricWords({ placement: "ribbons", seed: 1 });
        tracker.setTrack("Steady House", LOOP);
        tracker.setLyrics({ found: true, synced: LYRICS });
        tracker.read({ position: 0, wall: 0, rate: 1, playing: true });
        return tracker;
    };
    // Words at s into the loop, asked frame by frame up to there, as the bar does.
    const wordsAt = (tracker, seconds) => {
        for (let ms = 0; ms < seconds * 1000; ms += 50)
            tracker.words(ms);
        return tracker.words(seconds * 1000);
    };

    test("show nothing before the first line, then its words as they're sung", () => {
        assert.deepEqual(texts(wordsAt(bar(), 0.5)), []);
        assert.deepEqual(texts(wordsAt(bar(), 2.1)), ["Neon", "rivers", "light"]);
    });

    test("dissolve after a line, and show nothing in the instrumental gap", () => {
        const tracker = bar();
        const night = wordsAt(tracker, 5.5).filter(w => w.text === "night");
        assert.ok(night.length === 1 && night[0].dissolve > 0 && night[0].dissolve < 1, "the first line dissolving");
        assert.deepEqual(texts(wordsAt(bar(), 11.5)), []);
    });

    test("are all gone before the loop wraps, so every loop shows the same words", () => {
        assert.ok(wordsAt(bar(), 22.5).some(w => w.text === "Dancing"));
        assert.deepEqual(texts(wordsAt(bar(), 23.5)), []);
        assert.ok(LYRICS.every(l => l.t >= 0 && l.e <= LOOP));
    });
});

const python = spawnSync("/usr/bin/python3", ["-I", "-c", ""]).status === 0;

describe("harness stand-in DMS socket", { skip: !python && "needs python3" }, () => {
    const dirs = [], procs = [];
    after(() => {
        for (const p of procs) p.kill();
        for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    });

    // Starts the stand-in in a runtime dir of its own; resolves to its socket's path, once it's there.
    async function startDms() {
        const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "bvh-dms-test."));
        dirs.push(runtime);
        const log = path.join(runtime, "dms.log");
        const p = spawn(`${HARNESS}/dms`, [], { env: { ...process.env, XDG_RUNTIME_DIR: runtime, HARNESS_DMS_LOG: log }, stdio: "inherit" });
        procs.push(p);
        const sock = path.join(runtime, `dms-${p.pid}.sock`);
        for (let i = 0; i < 50 && !fs.existsSync(sock); i++)
            await new Promise(resolve => setTimeout(resolve, 100));
        assert.ok(fs.existsSync(sock), "the stand-in never made dms-<its pid>.sock");
        return { sock, log };
    }

    // Connects as the bar does: newline-delimited JSON, the hello first, then a reply per request.
    function connect(sock) {
        const client = net.createConnection(sock);
        const queue = [], waiting = [];
        let buffer = "";
        client.on("data", data => {
            buffer += data;
            let nl;
            while ((nl = buffer.indexOf("\n")) >= 0) {
                const message = JSON.parse(buffer.slice(0, nl));
                buffer = buffer.slice(nl + 1);
                (waiting.shift() ?? (m => queue.push(m)))(message);
            }
        });
        const next = () => queue.length ? Promise.resolve(queue.shift()) : new Promise(resolve => waiting.push(resolve));
        const ask = (id, title) => {
            client.write(JSON.stringify({ id, method: "lyrics.get", params: { allowNetwork: false, title, artist: "Harness", album: "Replay", duration: 24, fileUrl: "", providers: ["lrclib"] } }) + "\n");
            return next();
        };
        return { next, ask, close: () => client.end() };
    }

    test("says hello with the lyrics capability, and answers the reference track's title with the timed lyrics", async () => {
        const { sock, log } = await startDms();
        const dms = connect(sock);
        assert.ok((await dms.next()).capabilities.includes("lyrics"));
        const reply = await dms.ask(7, "Steady House");
        assert.equal(reply.id, 7);
        assert.equal(reply.result.found, true);
        assert.deepEqual(reply.result.synced, LYRICS);
        dms.close();
        assert.match(fs.readFileSync(log, "utf8"), /lyrics\.get .*"Steady House".* -> found$/m);
    });

    test("finds nothing for any other track (the silent one)", async () => {
        const { sock } = await startDms();
        const dms = connect(sock);
        await dms.next();
        const reply = await dms.ask(1, "Silence");
        assert.equal(reply.result.found, false);
        assert.deepEqual(reply.result.synced, []);
        dms.close();
    });
});

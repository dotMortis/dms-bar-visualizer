// The replay harness's Lock Ring host (harness/lockhost/): a test qs that loads the plugin as DMS
// does, with stand-ins for the parts of DMS the plugin uses. Here: that its stand-in lyrics service
// gives the Lock Ring the same timed lyrics the bar gets from the stand-in DMS socket, through the
// Lock Ring's own path (LockLyrics.qml), and that the host has every DMS name the plugin uses.
// The host itself doesn't run here.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createLyricWords } from "../docs/lyric-words.mjs";
import { LYRICS_TITLE, lyricsFor } from "../harness/lockhost/Services/lyrics.mjs";

const ROOT = path.join(import.meta.dirname, "..");
const HARNESS = path.join(ROOT, "harness");
const HOST = path.join(HARNESS, "lockhost");
const LYRICS = JSON.parse(fs.readFileSync(path.join(HARNESS, "lyrics.json"), "utf8"));
const LOOP = 24.05; // s, the reference track's loop

const texts = words => words.map(w => w.text);

describe("the Lock Ring host's stand-in lyrics service", () => {
    // LockLyrics.qml's tracker, fed the stand-in controller's lines for `title` as LockLyrics
    // passes them ({ state, synced }), the track at its start at wall 0 and playing.
    const ring = title => {
        const controller = lyricsFor(title, LYRICS);
        const tracker = createLyricWords({ placement: "ribbons-or-hands", seed: 1 });
        tracker.setTrack(title, LOOP);
        tracker.setLyrics({ state: controller.state, synced: controller.synced ? controller.lines : [] });
        tracker.read({ position: 0, wall: 0, rate: 1, playing: true });
        return tracker;
    };
    const wordsAt = (tracker, seconds) => {
        for (let ms = 0; ms < seconds * 1000; ms += 50)
            tracker.words(ms);
        return tracker.words(seconds * 1000);
    };

    test("gives the reference track the timed lyrics: the bar's words at the bar's times", () => {
        assert.deepEqual(texts(wordsAt(ring("Steady House"), 0.5)), []);
        assert.deepEqual(texts(wordsAt(ring("Steady House"), 2.1)), ["Neon", "rivers", "light"]);
        assert.deepEqual(texts(wordsAt(ring("Steady House"), 11.5)), []);
    });

    test("finds none for any other track (the silent one), as DMS reports it", () => {
        const none = lyricsFor("Silence", LYRICS);
        assert.deepEqual([none.state, none.synced, none.lines], ["none", false, []]);
        assert.deepEqual(texts(wordsAt(ring("Silence"), 2.1)), []);
    });

    test("serves the title the stand-in DMS socket serves, so both hosts get lyrics for the same track", () => {
        const dms = fs.readFileSync(path.join(HARNESS, "dms"), "utf8").match(/^LYRICS_TITLE = "([^"]+)"$/m);
        assert.ok(dms, "harness/dms names its LYRICS_TITLE");
        assert.equal(LYRICS_TITLE, dms[1]);
    });
});

describe("the Lock Ring host", () => {
    const plugin = fs.readdirSync(path.join(ROOT, "lock-ring")).filter(f => f.endsWith(".qml"))
        .map(f => ({ file: f, text: fs.readFileSync(path.join(ROOT, "lock-ring", f), "utf8") }));
    // What a stand-in type declares: its properties and functions.
    const declared = file => new Set([...fs.readFileSync(file, "utf8")
        .matchAll(/^\s*(?:readonly\s+)?(?:property\s+\S+\s+(\w+)|function\s+(\w+))/gm)].map(m => m[1] ?? m[2]));

    test("has a stand-in for every DMS module the plugin imports (qs.*), since a missing one fails its load", () => {
        const modules = new Set(plugin.flatMap(({ text }) => [...text.matchAll(/^import\s+qs\.([\w.]+)/gm)].map(m => m[1])));
        assert.ok(modules.has("Common") && modules.has("Services") && modules.has("Modules.Plugins"));
        for (const m of modules) {
            const dir = path.join(HOST, ...m.split("."));
            assert.ok(fs.existsSync(dir) && fs.readdirSync(dir).some(f => f.endsWith(".qml")), `no stand-in for qs.${m}`);
        }
    });

    test("declares every member of a DMS type the plugin uses", () => {
        const types = fs.readdirSync(HOST, { recursive: true }).filter(f => f.endsWith(".qml") && f !== "shell.qml")
            .map(f => ({ name: path.basename(f, ".qml"), members: declared(path.join(HOST, f)) }));
        let checked = 0;
        for (const { file, text } of plugin) {
            for (const { name, members } of types) {
                for (const [, member] of text.matchAll(new RegExp(`(?<![/\\w])${name}\\.(\\w+)`, "g"))) {
                    assert.ok(members.has(member), `${file} uses ${name}.${member}, which the host's ${name} lacks`);
                    checked++;
                }
            }
        }
        assert.ok(checked >= 5, "SettingsData, Theme and LyricsService are used");
        // What LockRing.qml sets on its root, DMS's DesktopPluginComponent, and what DMS sets on it.
        const component = types.find(t => t.name === "DesktopPluginComponent").members;
        for (const member of ["minWidth", "minHeight", "pluginService", "pluginId", "instanceId", "instanceData", "lockScreen", "widgetWidth", "widgetHeight"])
            assert.ok(component.has(member), `DesktopPluginComponent lacks ${member}`);
    });
});

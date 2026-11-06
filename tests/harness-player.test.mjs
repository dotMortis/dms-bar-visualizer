// The replay harness's stand-in Active Player (harness/player), over a private D-Bus as the
// visualizers see it. Skipped without dbus-daemon, busctl and python-dbus (the harness's own needs).
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const HARNESS = path.join(import.meta.dirname, "..", "harness");
const NAME = "org.mpris.MediaPlayer2.harness", OBJ = "/org/mpris/MediaPlayer2";
const ROOT = "org.mpris.MediaPlayer2", PLAYER = "org.mpris.MediaPlayer2.Player";

const have = cmd => spawnSync("sh", ["-c", `command -v ${cmd}`]).status === 0;
const usable = have("dbus-daemon") && have("busctl")
    && spawnSync("/usr/bin/python3", ["-I", "-c", "import dbus, gi.repository.GLib"]).status === 0;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

describe("harness stand-in player", { skip: !usable && "needs dbus-daemon, busctl and python-dbus" }, () => {
    let bus, address;
    const players = [];

    before(async () => {
        bus = spawn("dbus-daemon", [`--config-file=${HARNESS}/bus.conf`, "--print-address=1", "--nofork"]);
        address = await new Promise((resolve, reject) => {
            bus.stdout.once("data", data => resolve(data.toString().trim()));
            bus.once("exit", code => reject(new Error(`dbus-daemon exited ${code}`)));
        });
    });
    after(() => {
        for (const p of players) p.kill();
        bus?.kill();
    });

    const busctl = (...args) => JSON.parse(execFileSync("busctl", [`--address=${address}`, "--json=short", ...args]).toString() || "null");
    const prop = (iface, name) => busctl("get-property", NAME, OBJ, iface, name).data;
    const call = method => execFileSync("busctl", [`--address=${address}`, "call", NAME, OBJ, PLAYER, method]);

    // Starts the player with env and waits until it owns its name.
    async function startPlayer(env) {
        const p = spawn(`${HARNESS}/player`, [], { env: { ...process.env, DBUS_SESSION_BUS_ADDRESS: address, ...env } });
        players.push(p);
        for (let i = 0; i < 50; i++) {
            if (busctl("list").some(n => n.name === NAME)) return p;
            await sleep(100);
        }
        throw new Error("the player never owned its name");
    }
    async function stopPlayer(p) {
        p.kill();
        await new Promise(resolve => p.once("exit", resolve));
    }

    test("playing: the track's metadata, and its position on the harness's timeline", async () => {
        const epoch = Date.now() / 1000 - 12.5;
        const p = await startPlayer({ HARNESS_PLAYER: "Playing", HARNESS_EPOCH: String(epoch), HARNESS_LOOP: "10", HARNESS_PLAYER_TITLE: "Steady House" });
        assert.equal(prop(ROOT, "Identity"), "harness");
        assert.equal(prop(PLAYER, "PlaybackStatus"), "Playing");
        const meta = prop(PLAYER, "Metadata");
        assert.equal(meta["xesam:title"].data, "Steady House");
        assert.deepEqual(meta["xesam:artist"].data, ["Harness"]);
        assert.equal(meta["mpris:length"].data, 10_000_000);
        // 12.5 s after the epoch on a 10 s loop: 2.5 s into the track's second loop.
        const pos = prop(PLAYER, "Position") / 1e6;
        assert.ok(pos > 2.4 && pos < 3.0, `position ${pos}`);
        await stopPlayer(p);
    });

    test("paused: the position holds; Play starts it from there", async () => {
        const p = await startPlayer({ HARNESS_PLAYER: "Paused", HARNESS_LOOP: "10", HARNESS_PLAYER_POSITION: "4" });
        assert.equal(prop(PLAYER, "PlaybackStatus"), "Paused");
        assert.equal(prop(PLAYER, "Position"), 4_000_000);
        await sleep(300);
        assert.equal(prop(PLAYER, "Position"), 4_000_000);
        call("Play");
        assert.equal(prop(PLAYER, "PlaybackStatus"), "Playing");
        await sleep(300);
        const pos = prop(PLAYER, "Position") / 1e6;
        assert.ok(pos > 4.2 && pos < 4.8, `position ${pos}`);
        call("Pause");
        assert.equal(prop(PLAYER, "PlaybackStatus"), "Paused");
        await stopPlayer(p);
    });

    test("each loop's wrap back to the start is announced with Seeked, as a player that loops does", async () => {
        // A 1 s loop starting now: wraps at 1 s and 2 s.
        const monitor = spawn("busctl", [`--address=${address}`, "monitor", "--json=short", `--match=type='signal',interface='${PLAYER}',member='Seeked'`]);
        let out = "";
        monitor.stdout.on("data", data => out += data);
        await sleep(300);
        const p = await startPlayer({ HARNESS_PLAYER: "Playing", HARNESS_EPOCH: String(Date.now() / 1000), HARNESS_LOOP: "1" });
        await sleep(2300);
        monitor.kill();
        await stopPlayer(p);
        const seeks = out.split("\n").filter(Boolean).map(JSON.parse).filter(m => m.member === "Seeked").map(m => m.payload.data[0] / 1e6);
        assert.ok(seeks.length >= 2, `Seeked ${seeks.length} times`);
        for (const s of seeks) assert.ok(s < 0.1, `Seeked to ${s}`);
    });
});

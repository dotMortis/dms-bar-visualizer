// The replay harness's stand-in pactl (harness/bin/pactl): the sinks and streams the visualizer's
// sink probe (audio/AudioPipeline.qml) reads come from the scenario, not from what plays on the
// desktop, so a stream starting or stopping there can't restart the capture mid-run.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";

const PACTL = path.join(import.meta.dirname, "..", "harness", "bin", "pactl");
// As the probe runs it, with the real pactl stood in for by `true`.
const pactl = (player, ...args) => JSON.parse(execFileSync(PACTL, ["-f", "json", "list", ...args], {
    env: { ...process.env, HARNESS_PLAYER: player, HARNESS_PACTL: "/usr/bin/true" }
}).toString());

describe("harness stand-in pactl", () => {
    test("one sink, whatever the scenario", () => {
        for (const player of ["Playing", "Paused", "none"]) {
            const sinks = pactl(player, "sinks");
            assert.equal(sinks.length, 1);
            assert.ok(sinks[0].name && Number.isInteger(sinks[0].index));
        }
    });

    test("playing: the stand-in player's stream plays on that sink", () => {
        const [sink] = pactl("Playing", "sinks");
        const inputs = pactl("Playing", "sink-inputs");
        assert.equal(inputs.length, 1);
        assert.equal(inputs[0].sink, sink.index);
        assert.equal(inputs[0].corked, false);
        assert.equal(inputs[0].properties["application.name"], "harness", "the Active Player's stream, by its MPRIS identity");
    });

    test("reads as the probe reads it: its command's output, two JSON lines", () => {
        const out = execFileSync("sh", ["-c", "pactl -f json list sinks; echo; pactl -f json list sink-inputs"], {
            env: { ...process.env, PATH: `${path.dirname(PACTL)}:${process.env.PATH}`, HARNESS_PLAYER: "Playing", HARNESS_PACTL: "/usr/bin/true" }
        }).toString();
        const [sinks, inputs] = out.trim().split("\n").map(line => JSON.parse(line));
        assert.equal(inputs[0].sink, sinks[0].index);
    });

    test("subscribe: stays running and reports nothing, as the scenario's streams don't change", async () => {
        const sub = spawn(PACTL, ["subscribe"], { env: { ...process.env, HARNESS_PLAYER: "Playing", HARNESS_PACTL: "/usr/bin/true" } });
        let out = "";
        sub.stdout.on("data", d => out += d);
        sub.stderr.on("data", d => out += d);
        const exited = new Promise(resolve => sub.once("exit", code => resolve(code)));
        const early = await Promise.race([exited, new Promise(resolve => setTimeout(() => resolve("running"), 500))]);
        sub.kill();
        await exited;
        assert.equal(early, "running", out);
        assert.equal(out, "");
    });

    test("paused: its stream is corked; no player: no stream", () => {
        assert.deepEqual(pactl("Paused", "sink-inputs").map(i => i.corked), [true]);
        assert.deepEqual(pactl("none", "sink-inputs"), []);
    });
});

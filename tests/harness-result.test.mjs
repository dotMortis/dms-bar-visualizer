// harness/run's result.json, as harness/result.mjs builds it from the run's fields and its measures'
// own JSON: escaped as JSON, typed, in order.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { buildResult } from "../harness/result.mjs";

const files = { "/run/frames.json": '{"frames": 1442, "frames_fps": 59.96}', "/run/gpu.json": '{"gpu_busy_pct": 5.61}' };
const read = f => files[f];

describe("harness result.json", () => {
    test("strings stay strings, quotes and backslashes included", () => {
        const r = buildResult(['s:tree=working tree at "v0.10.0"\\x', "s:player_title=Silence"], read);
        assert.deepEqual(JSON.parse(JSON.stringify(r)), { tree: 'working tree at "v0.10.0"\\x', player_title: "Silence" });
    });

    test("numbers and flags are typed, as the shell printed them", () => {
        assert.deepEqual(buildResult(["n:window_s=24.050200", "n:dms=0", "b:dirty=true", "b:clean=false"], read),
            { window_s: 24.0502, dms: 0, dirty: true, clean: false });
    });

    test("a number the shell couldn't print is an error, not a NaN or a string in result.json", () => {
        assert.throws(() => buildResult(["n:lyrics_requests="], read), /lyrics_requests/);
        assert.throws(() => buildResult(["n:cpu_pct=1.2.3"], read), /cpu_pct/);
        assert.throws(() => buildResult(["b:dirty=maybe"], read), /dirty/);
    });

    test("each measure's own JSON is merged in, in order, after the run's fields", () => {
        const r = buildResult(["s:scenario=music", "@/run/frames.json", "@/run/gpu.json"], read);
        assert.deepEqual(Object.keys(r), ["scenario", "frames", "frames_fps", "gpu_busy_pct"]);
        assert.equal(r.frames, 1442);
    });
});

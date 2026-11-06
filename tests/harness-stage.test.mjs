// The recording stage (harness/run --record): its size from the desktop's monitor, and the part of
// it a recording keeps, from the stage's own `hyprctl -j` answers. Only that arithmetic runs here.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { recordRegion, stageMode } from "../harness/stage.mjs";

// `hyprctl -j layers`, cut to what is read: per monitor, layer level, then the layer surfaces.
const layers = (...ls) => ({ STAGE: { levels: { 0: [], 1: ls, 2: [], 3: [] } } });
const layer = (namespace, x, y, w, h) => ({ namespace, x, y, w, h });

describe("harness recording stage", () => {
    test("the stage is the desktop's first monitor in logical pixels, cut to even sizes for the encoder", () => {
        const monitors = [{ name: "HDMI-A-3", width: 3440, height: 1440, scale: 1.0666667, refreshRate: 59.973 }];
        assert.equal(stageMode(monitors), "3224x1350@60");
    });

    test("without a monitor to follow the stage is 1920x1080", () => {
        assert.equal(stageMode([]), "1920x1080@60");
    });

    test("a recording keeps the visualizer's window alone, cut to even sizes", () => {
        const answer = layers(layer("other", 0, 0, 100, 100), layer("bar-visualizer", 0, 0, 3224, 45));
        assert.equal(recordRegion(answer, "bar-visualizer"), "0,0 3224x44");
    });

    test("no window by that name is no region", () => {
        assert.equal(recordRegion(layers(layer("other", 0, 0, 10, 10)), "lock-ring-harness"), null);
    });
});

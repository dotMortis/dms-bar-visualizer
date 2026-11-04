// The Lock Ring's clock: the hands always point at the true time, and the second hand sweeps
// instead of ticking. The digital time follows DMS's 12h/24h setting, without seconds.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { formatTime, handAngles } from "../lock-ring/clock.mjs";

// Local wall-clock time on 2026-11-04.
const at = (h, m, s = 0, ms = 0) => new Date(2026, 10, 4, h, m, s, ms);

describe("hand angles", () => {
    test("at 3:00:00 the hour hand points at 3 and the others at 12", () => {
        assert.deepEqual(handAngles(at(3, 0)), { hour: 90, minute: 0, second: 0 });
    });

    test("at 15:00 the hour hand points at 3, like at 3:00", () => {
        assert.deepEqual(handAngles(at(15, 0)), { hour: 90, minute: 0, second: 0 });
    });

    test("at 9:30 the hour hand is halfway between 9 and 10", () => {
        assert.deepEqual(handAngles(at(9, 30)), { hour: 285, minute: 180, second: 0 });
    });

    test("the minute hand moves on with the seconds", () => {
        assert.equal(handAngles(at(12, 10, 30)).minute, 63);
    });

    test("the second hand sweeps: at 12:00:15.5 it is past the 15 s mark by half a second", () => {
        assert.equal(handAngles(at(12, 0, 15, 500)).second, 93);
    });

    test("the second hand moves on every frame within a second", () => {
        const frames = Array.from({ length: 60 }, (_, n) => handAngles(at(12, 0, 7, n * 1000 / 60)).second);
        for (let n = 1; n < frames.length; n++)
            assert.ok(frames[n] > frames[n - 1], `frame ${n}: ${frames[n]} after ${frames[n - 1]}`);
        assert.ok(frames[59] < 48, "still short of the next second");
    });

    test("just before midnight every hand is just short of a full turn", () => {
        const { hour, minute, second } = handAngles(at(23, 59, 59, 999));
        for (const angle of [hour, minute, second]) {
            assert.ok(angle < 360, `${angle} < 360`);
            assert.ok(angle > 359.9, `${angle} > 359.9`);
        }
    });
});

// DMS's setting: SettingsData.use24HourClock, and SettingsData.padHours12Hour for 12h.
describe("digital time", () => {
    const H24 = { use24Hour: true };
    const H12 = { use24Hour: false, padHours12Hour: false };
    const H12_PADDED = { use24Hour: false, padHours12Hour: true };

    test("24h pads hours and minutes to two digits", () => {
        assert.equal(formatTime(at(9, 5), H24), "09:05");
        assert.equal(formatTime(at(0, 0), H24), "00:00");
        assert.equal(formatTime(at(23, 59), H24), "23:59");
    });

    test("never shows seconds", () => {
        assert.equal(formatTime(at(14, 7, 59, 999), H24), "14:07");
        assert.equal(formatTime(at(14, 7, 59, 999), H12), "2:07 PM");
    });

    test("12h counts 12, 1, ... 11 with AM before noon and PM from noon", () => {
        assert.equal(formatTime(at(0, 15), H12), "12:15 AM");
        assert.equal(formatTime(at(9, 5), H12), "9:05 AM");
        assert.equal(formatTime(at(11, 59), H12), "11:59 AM");
        assert.equal(formatTime(at(12, 0), H12), "12:00 PM");
        assert.equal(formatTime(at(21, 30), H12), "9:30 PM");
    });

    test("12h pads the hour when DMS is set to", () => {
        assert.equal(formatTime(at(9, 5), H12_PADDED), "09:05 AM");
        assert.equal(formatTime(at(12, 0), H12_PADDED), "12:00 PM");
    });
});

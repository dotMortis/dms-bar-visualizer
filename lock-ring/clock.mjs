// The Lock Ring's clock, apart from drawing: where the hands point and how the digital time reads.
// Plain JS so tests/lock-clock.test.mjs can run it under node; LockRing.qml imports it.

// Clockwise degrees from 12 o'clock for each hand at the local time `date`. Every hand moves on
// with the units below it, down to the millisecond, so the second hand sweeps instead of ticking.
export function handAngles(date) {
    const seconds = date.getSeconds() + date.getMilliseconds() / 1000;
    const minutes = date.getMinutes() + seconds / 60;
    const hours = date.getHours() % 12 + minutes / 60;
    return { hour: hours * 30, minute: minutes * 6, second: seconds * 6 };
}

// The digital time as HH:MM, without seconds: "09:05" in 24h, "9:05 AM" in 12h ("09:05 AM" with
// padHours12Hour). Takes DMS's SettingsData.use24HourClock and SettingsData.padHours12Hour.
export function formatTime(date, { use24Hour, padHours12Hour = false }) {
    const pad = n => String(n).padStart(2, "0");
    const hours = date.getHours(), minutes = pad(date.getMinutes());
    if (use24Hour)
        return `${pad(hours)}:${minutes}`;
    const hours12 = hours % 12 || 12;
    return `${padHours12Hour ? pad(hours12) : hours12}:${minutes} ${hours < 12 ? "AM" : "PM"}`;
}

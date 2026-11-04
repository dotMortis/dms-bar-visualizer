// The Lock Ring's clock, apart from drawing: where the hands point, how the digital time reads,
// where it sits and how it takes a shockwave's hit. Plain JS so tests/lock-clock.test.mjs can run
// it under node; LockRing.qml, LockAudio.qml (for TIME_RADIUS) and the demo import it.

// Clockwise degrees from 12 o'clock for each hand at the local time `date`. Every hand moves on
// with the units below it, down to the millisecond, so the second hand sweeps instead of ticking.
export function handAngles(date) {
    const seconds = date.getSeconds() + date.getMilliseconds() / 1000;
    const minutes = date.getMinutes() + seconds / 60;
    const hours = date.getHours() % 12 + minutes / 60;
    return { hour: hours * 30, minute: minutes * 6, second: seconds * 6 };
}

// Where the digital time sits, below the center, in dial radii: its top (where LockRing.qml and
// the demo place it) and the middle of its digits, the radius a shockwave hits it at.
export const TIME_TOP = 0.38;
export const TIME_RADIUS = 0.5;

// The digital time's look at the hardest hit, tuned by eye in the demo. Sizes are in font sizes.
//   split  how far each copy is pushed outward (away from the center), in the shockwave's order:
//          lavender leads its front, mauve and blue trail it (ring.frag)
//   glow   the glow's blur radius
//   white  how far the digits flare toward white, 0..1
export const TIME_HIT = {
    split: [["#b4befe", 0.16], ["#cba6f7", 0.11], ["#89b4fa", 0.06]],
    opacity: 0.9,
    glow: 0.35,
    white: 0.6,
};

// How the digital time takes a shockwave crossing it (`crossing`, 0..1: kicks.mjs
// shockwaveCrossing() at TIME_RADIUS), the same in LockRing.qml and the demo: three copies in the
// shockwave's colors, each `offset` outward at `opacity`, and the digits glowing (`glow`, the
// blur radius) and flaring toward white (`white`). It scales with the crossing; the digits
// themselves never move.
export function timeHit(crossing) {
    const k = Number.isFinite(crossing) ? Math.min(1, Math.max(0, crossing)) : 0;
    return {
        copies: TIME_HIT.split.map(([color, offset]) => ({ color, offset: offset * k, opacity: TIME_HIT.opacity * k })),
        glow: TIME_HIT.glow * k,
        white: TIME_HIT.white * k,
    };
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

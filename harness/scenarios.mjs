// The harness's scenarios and the hosts the performance page measures: the one list harness/run
// takes its input from and harness/table.mjs its columns.
//
//   node harness/scenarios.mjs <scenario>   the scenario's input as KEY=value lines, for harness/run:
//   REFERENCE, LOOP_LENGTH (s), FIXTURE (the band stream, or empty), SILENT (1: cava's silence
//   instead), TRACK (its name in the report), PLAYER (the stand-in Active Player's PlaybackStatus at
//   start, or none), PLAYER_TITLE (the track it reports), DMS (1: a stand-in for DMS's lyrics)
import fs from "node:fs";
import { fileURLToPath } from "node:url";

// The reference track (harness/reference.json, also read by harness/dms, harness/player and the
// Lock Ring host's lyrics service): its fixture in tests/fixtures and the title the stand-in player
// reports for it, the one title the stand-in DMS has the timed lyrics (harness/lyrics.json) for.
export const REFERENCE = JSON.parse(fs.readFileSync(new URL("reference.json", import.meta.url), "utf8"));

export const HOSTS = ["bar", "lock"];

// Each plays a track as long as the reference track's loop, on the same timeline.
export const SCENARIOS = {
    music: { silent: false, player: "Playing", title: REFERENCE.title, dms: false },
    music_lyrics: { silent: false, player: "Playing", title: REFERENCE.title, dms: true },
    silence_no_player: { silent: true, player: "none", title: "", dms: false },
    silence_paused: { silent: true, player: "Paused", title: REFERENCE.title, dms: false },
    // A silent track has no words: the stand-in DMS finds none for "Silence".
    silence_playing: { silent: true, player: "Playing", title: "Silence", dms: true },
};

// A scenario's input for harness/run: the KEY=value lines above.
export async function scenarioInput(name) {
    const s = Object.hasOwn(SCENARIOS, name) ? SCENARIOS[name] : null;
    if (!s) return null;
    const { replayTrack } = await import("./kicks.mjs");
    const fixture = fileURLToPath(new URL(`../tests/fixtures/${REFERENCE.track}.txt`, import.meta.url));
    return {
        REFERENCE: REFERENCE.track,
        LOOP_LENGTH: replayTrack(REFERENCE.track).length.toFixed(6),
        FIXTURE: s.silent ? "" : fixture,
        SILENT: s.silent ? 1 : 0,
        TRACK: s.silent ? "silence" : REFERENCE.track,
        PLAYER: s.player,
        PLAYER_TITLE: s.title,
        DMS: s.dms ? 1 : 0,
    };
}

if (import.meta.main) {
    const [name] = process.argv.slice(2);
    const input = await scenarioInput(name);
    if (!input) {
        console.error(`harness: no scenario '${name}' (${Object.keys(SCENARIOS).join(", ")})`);
        process.exit(2);
    }
    for (const [k, v] of Object.entries(input)) console.log(`${k}=${v}`);
}

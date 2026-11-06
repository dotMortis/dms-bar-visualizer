// Which player is the Active Player, and which output the capture follows. The audio pipeline
// (audio/AudioPipeline.qml) asks audio/active-player.mjs both; these tests replay event sequences
// (players starting, pausing, disappearing; streams starting, moving output) through it.
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { chooseActivePlayer, chooseSource } from "../audio/active-player.mjs";

// Replays MPRIS events, as the pipeline sees them: players come and go, and a player's isPlaying
// changes on the same object (as a Quickshell MprisPlayer's does). After each event the pipeline
// chooses again; returns the Active Player's identity after each, null for none.
function replayPlayers(events) {
    const players = new Map();
    let active = null;
    return events.map(([what, name]) => {
        if (what === "appear")
            players.set(name, { identity: name, isPlaying: false });
        else if (what === "play")
            players.get(name).isPlaying = true;
        else if (what === "pause")
            players.get(name).isPlaying = false;
        else if (what === "vanish")
            players.delete(name);
        active = chooseActivePlayer(active, [...players.values()]);
        return active?.identity ?? null;
    });
}

describe("the Active Player", () => {
    test("is the first player to appear, while none plays", () => {
        assert.deepEqual(replayPlayers([["appear", "spotify"], ["appear", "firefox"]]), ["spotify", "spotify"]);
    });

    test("switches to a player as it starts playing", () => {
        assert.deepEqual(replayPlayers([["appear", "spotify"], ["appear", "firefox"], ["play", "firefox"]]),
            ["spotify", "spotify", "firefox"]);
    });

    test("stays while it plays, though another starts too", () => {
        assert.deepEqual(replayPlayers([["appear", "spotify"], ["appear", "firefox"], ["play", "spotify"], ["play", "firefox"]]),
            ["spotify", "spotify", "spotify", "spotify"]);
    });

    test("stays paused until another plays", () => {
        assert.deepEqual(replayPlayers([
            ["appear", "spotify"], ["appear", "firefox"], ["play", "firefox"], ["pause", "firefox"], ["play", "spotify"],
        ]), ["spotify", "spotify", "firefox", "firefox", "spotify"]);
    });

    test("switches to another one still playing when it pauses", () => {
        // Both play, the Active Player pauses: the other one is playing, so it takes over.
        assert.deepEqual(replayPlayers([
            ["appear", "spotify"], ["appear", "firefox"], ["play", "spotify"], ["play", "firefox"], ["pause", "spotify"],
        ]), ["spotify", "spotify", "spotify", "spotify", "firefox"]);
    });

    test("moves on when it disappears: to one playing, else the first left, else none", () => {
        assert.deepEqual(replayPlayers([
            ["appear", "spotify"], ["appear", "firefox"], ["appear", "mpv"], ["play", "mpv"], ["play", "firefox"],
            ["vanish", "mpv"], ["pause", "firefox"], ["vanish", "firefox"], ["vanish", "spotify"],
        ]), ["spotify", "spotify", "spotify", "mpv", "mpv", "firefox", "firefox", "spotify", null]);
    });
});

// Sinks and sink inputs (streams) as `pactl -f json list sinks` / `list sink-inputs` print them,
// cut to the fields the choice reads.
const SPEAKERS = { index: 52, name: "alsa_output.pci-0000_0c_00.4.analog-stereo" };
const HEADSET = { index: 87, name: "bluez_output.AC_80_0A_12_34_56.1" };
const stream = (index, sink, app, corked = false) => ({
    index, sink, corked,
    properties: { "application.name": app, "application.process.binary": app.toLowerCase(), "node.name": app },
});
const SPOTIFY = { identity: "Spotify", desktopEntry: "spotify", dbusName: "org.mpris.MediaPlayer2.spotify" };
const FIREFOX = { identity: "Mozilla Firefox", desktopEntry: "firefox", dbusName: "org.mpris.MediaPlayer2.firefox.instance_1_42" };

describe("the capture source", () => {
    test("is the monitor of the output the Active Player's playing stream plays to", () => {
        const inputs = [stream(301, SPEAKERS.index, "Spotify"), stream(305, HEADSET.index, "Firefox")];
        assert.equal(chooseSource(SPOTIFY, [SPEAKERS, HEADSET], inputs), `${SPEAKERS.name}.monitor`);
        assert.equal(chooseSource(FIREFOX, [SPEAKERS, HEADSET], inputs), `${HEADSET.name}.monitor`);
    });

    test("falls back to the newest playing stream, then the default output", () => {
        const sinks = [SPEAKERS, HEADSET];
        const mpv = { identity: "mpv", desktopEntry: "mpv", dbusName: "org.mpris.MediaPlayer2.mpv" };
        const inputs = [stream(301, SPEAKERS.index, "Spotify"), stream(305, HEADSET.index, "Firefox"), stream(310, SPEAKERS.index, "mpv", true)];
        // mpv's stream is corked (paused): not playing, so the newest playing one, Firefox's, wins.
        assert.equal(chooseSource(mpv, sinks, inputs), `${HEADSET.name}.monitor`);
        assert.equal(chooseSource(null, sinks, inputs), `${HEADSET.name}.monitor`);
        assert.equal(chooseSource(SPOTIFY, sinks, [stream(310, SPEAKERS.index, "Spotify", true)]), "auto");
        assert.equal(chooseSource(SPOTIFY, sinks, []), "auto");
    });

    test("matches a player's stream by its binary, its desktop entry or its D-Bus name, case ignored", () => {
        const chromium = { identity: "Chromium", dbusName: "org.mpris.MediaPlayer2.chromium.instance4242" };
        const named = (app, binary) => ({ index: 400, sink: HEADSET.index, corked: false,
            properties: { "application.name": app, "application.process.binary": binary } });
        const sinks = [SPEAKERS, HEADSET];
        const newer = stream(500, SPEAKERS.index, "Other");
        assert.equal(chooseSource(chromium, sinks, [named("Chromium input", "chrome"), newer]), `${HEADSET.name}.monitor`);
        assert.equal(chooseSource(FIREFOX, sinks, [named("Web Content", "firefox-bin"), newer]), `${HEADSET.name}.monitor`);
        assert.equal(chooseSource(SPOTIFY, sinks, [named("Web Content", "firefox-bin"), newer]), `${SPEAKERS.name}.monitor`);
    });
});

// Replays player and stream events together, choosing again after each as the pipeline does:
// [the Active Player's identity, the capture source] after each event.
function replay(events) {
    const players = new Map(), streams = new Map(), sinks = [SPEAKERS, HEADSET];
    const apps = { Spotify: SPOTIFY, "Mozilla Firefox": FIREFOX };
    let active = null;
    return events.map(([what, name, arg]) => {
        if (what === "appear")
            players.set(name, { ...apps[name], isPlaying: false });
        else if (what === "play" || what === "pause")
            players.get(name).isPlaying = what === "play";
        else if (what === "vanish")
            players.delete(name);
        else if (what === "stream")  // a stream starts, or moves, to the sink `arg`
            streams.set(name, stream(streams.get(name)?.index ?? 300 + streams.size, arg.index, name));
        else if (what === "cork" || what === "uncork")
            streams.get(name).corked = what === "cork";
        else if (what === "end")
            streams.delete(name);
        active = chooseActivePlayer(active, [...players.values()]);
        return [active?.identity ?? null, chooseSource(active, sinks, [...streams.values()])];
    });
}

describe("the Active Player and the capture source, replayed", () => {
    const speakers = `${SPEAKERS.name}.monitor`, headset = `${HEADSET.name}.monitor`;

    test("start, then the stream moving to another output (to Bluetooth)", () => {
        assert.deepEqual(replay([
            ["appear", "Spotify"], ["play", "Spotify"], ["stream", "Spotify", SPEAKERS], ["stream", "Spotify", HEADSET],
        ]), [["Spotify", "auto"], ["Spotify", "auto"], ["Spotify", speakers], ["Spotify", headset]]);
    });

    test("pause: the paused player stays, and the capture falls back to whatever else plays", () => {
        assert.deepEqual(replay([
            ["appear", "Spotify"], ["play", "Spotify"], ["stream", "Spotify", SPEAKERS], ["stream", "Firefox", HEADSET],
            ["pause", "Spotify"], ["cork", "Spotify"],
        ]), [["Spotify", "auto"], ["Spotify", "auto"], ["Spotify", speakers], ["Spotify", speakers],
             ["Spotify", speakers], ["Spotify", headset]]);
    });

    test("switch: another player starts, and the capture follows it to its output", () => {
        assert.deepEqual(replay([
            ["appear", "Spotify"], ["appear", "Mozilla Firefox"], ["play", "Spotify"], ["stream", "Spotify", SPEAKERS],
            ["pause", "Spotify"], ["cork", "Spotify"], ["play", "Mozilla Firefox"], ["stream", "Firefox", HEADSET],
        ]), [["Spotify", "auto"], ["Spotify", "auto"], ["Spotify", "auto"], ["Spotify", speakers],
             ["Spotify", speakers], ["Spotify", "auto"], ["Mozilla Firefox", "auto"], ["Mozilla Firefox", headset]]);
    });

    test("the player disappearing: none is left, and with its stream gone the default output", () => {
        assert.deepEqual(replay([
            ["appear", "Spotify"], ["play", "Spotify"], ["stream", "Spotify", HEADSET], ["vanish", "Spotify"], ["end", "Spotify"],
        ]), [["Spotify", "auto"], ["Spotify", "auto"], ["Spotify", headset], [null, headset], [null, "auto"]]);
    });
});

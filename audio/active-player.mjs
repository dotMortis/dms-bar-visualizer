// The audio pipeline's two choices, as plain ECMAScript that QML and node both load, so node tests
// can replay them: which player is the Active Player, and which output the capture follows.
// audio/AudioPipeline.qml calls it; lock-ring/audio/ links here, next to its link to the pipeline.

// The Active Player among `players` (MPRIS players, or anything with isPlaying), given the one
// chosen last time (`current`, null for none). Mirrors DankBar's choice: keep the current player
// while it plays, otherwise switch to any player that starts playing; a paused player stays active
// until another one plays. Null when there are no players.
export function chooseActivePlayer(current, players) {
    if (current && current.isPlaying && players.includes(current))
        return current;
    const playing = players.find(p => p.isPlaying);
    if (playing)
        return playing;
    if (players.includes(current))
        return current;
    return players[0] ?? null;
}

// The source the capture follows: the monitor of the output (sink) the Active Player's playing
// stream plays to, else the newest playing stream's, else "auto" (cava's default output).
// `sinks` and `inputs` are as `pactl -f json list sinks` / `list sink-inputs` print them; a corked
// stream isn't playing.
export function chooseSource(player, sinks, inputs) {
    const playing = inputs.filter(i => !i.corked).sort((a, b) => b.index - a.index);
    const stream = playing.find(s => matchesPlayer(player, s)) ?? playing[0];
    const sink = stream ? sinks.find(s => s.index === stream.sink) : null;
    return sink ? `${sink.name}.monitor` : "auto";
}

// Whether a stream is `player`'s: one of its names (application name, binary, id, node name)
// matches one of the player's (identity, desktop entry, the D-Bus name's first part), either one
// a prefix of the other, case ignored.
export function matchesPlayer(player, stream) {
    if (!player)
        return false;
    const keys = [player.identity, player.desktopEntry, player.dbusName?.replace(/^org\.mpris\.MediaPlayer2\./, "").split(".")[0]]
        .filter(Boolean).map(k => k.toLowerCase());
    const props = stream.properties ?? {};
    const names = [props["application.name"], props["application.process.binary"], props["application.id"], props["node.name"]]
        .filter(Boolean).map(n => n.toLowerCase());
    return names.some(n => keys.some(k => n === k || n.startsWith(k) || k.startsWith(n)));
}

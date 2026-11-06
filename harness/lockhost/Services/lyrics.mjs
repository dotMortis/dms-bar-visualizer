// What the Lock Ring host's stand-in lyrics service (LyricsService.qml) finds for a track: the
// fixed timed lyrics (harness/lyrics.json) for the reference track, the one the stand-in player
// plays (its title in harness/reference.json, as the stand-in DMS socket, harness/dms, reads it),
// and none for any other (the silent track, "Silence"). The lines go out as raw DMS synced lines:
// the Lock Ring's Lyric Words module takes them as well as DMS's grouped ones.

// The controller's state, synced and lines for `title`, as DMS's LyricsController ends up after
// its lookup: "ready" with the lines, or "none".
export function lyricsFor(title, timedLines, referenceTitle) {
    if (title === referenceTitle && timedLines.length > 0)
        return { state: "ready", synced: true, lines: timedLines };
    return { state: "none", synced: false, lines: [] };
}

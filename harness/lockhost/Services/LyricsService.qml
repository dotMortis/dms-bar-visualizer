// Stand-in for DMS's LyricsService (Services/, DMS v2.0+), the Lock Ring's Lyric Words source: the
// same controller properties LockLyrics.qml reads, with the fixed timed lyrics (HARNESS_LYRICS,
// harness/lyrics.json) for the reference track and none for any other (lyrics.mjs). Like DMS's, it
// follows the Active Player (the stand-in, the only player on the run's bus) only while subscribed,
// and anchors the playback clock to its position on a new track, a play or pause, a rate change
// and a seek (the stand-in's Seeked at each loop's wrap). Each lookup is logged to qs.log
// (`harness lyrics.get "<title>" -> found|none`), where harness/run counts them.
pragma Singleton
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.Mpris
import "lyrics.mjs" as Lyrics

Singleton {
    id: root

    property int refCount: 0

    function addRef() {
        refCount++;
    }

    function removeRef() {
        refCount = Math.max(0, refCount - 1);
    }

    readonly property bool subscribed: refCount > 0
    readonly property var player: subscribed ? (Mpris.players.values[0] ?? null) : null
    readonly property string title: player?.trackTitle ?? ""

    property var doc: null
    // The lookup for the playing track, once the lyrics are read.
    readonly property var found: player && doc ? Lyrics.lyricsFor(title, doc) : null
    onFoundChanged: {
        if (found)
            console.info(`harness lyrics.get "${title}" -> ${found.synced ? "found" : "none"}`);
    }

    FileView {
        path: Quickshell.env("HARNESS_LYRICS")
        onLoaded: root.doc = JSON.parse(text())
    }

    readonly property QtObject controller: QtObject {
        readonly property string state: root.found?.state ?? "idle"
        readonly property bool synced: root.found?.synced ?? false
        readonly property var lines: root.found?.lines ?? []
        readonly property string trackKey: root.player ? JSON.stringify([root.player.dbusName, root.title]) : ""
        readonly property real duration: root.player?.length ?? 0
        property real anchorPosition: 0
        property real anchorWall: 0
        property real anchorRate: 1
        property bool anchorPlaying: false
    }

    function reanchor() {
        const p = player;
        controller.anchorPosition = p?.position ?? 0;
        controller.anchorWall = Date.now();
        controller.anchorRate = p?.rate ?? 1;
        controller.anchorPlaying = p?.isPlaying ?? false;
    }

    onPlayerChanged: reanchor()
    onTitleChanged: reanchor()

    Connections {
        target: root.player
        function onIsPlayingChanged() { root.reanchor(); }
        function onRateChanged() { root.reanchor(); }
        function onPositionChanged() { root.reanchor(); }
    }
}

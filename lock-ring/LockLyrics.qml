// The Lock Ring's Lyric Words source: DMS's own lyrics service (qs.Services LyricsService, DMS
// v2.0+), timed through the shared Lyric Words module (docs/lyric-words.mjs). LockAudio loads this
// only while a ring is shown, lyrics are on (lockRing.lyrics) and DMS has the service, so an older
// DMS never compiles it. While loaded it holds a lyrics subscription: the service follows DMS's
// Active Player and looks up the playing track's lyrics whatever DMS's own Lyrics setting is (its
// `allowed` isn't checked: lockRing.lyrics alone decides).
//
// One instance for every ring (LockAudio is a singleton), so every monitor shows the same words.
import QtQuick
import Quickshell
import qs.Services
import "docs/lyric-words.mjs" as LyricWords

Scope {
    id: root

    // The Lyric Words visible this frame (lyric-words.mjs words()).
    property var words: []

    // A Kick the shared pipeline found just now, with its power: a word landing with it pops harder.
    function kick(power) {
        lyricWords.kick(power, Date.now());
    }

    readonly property var controller: LyricsService.controller
    // Placement varies from lock to lock.
    readonly property var lyricWords: LyricWords.createLyricWords({ placement: "ribbons-or-hands", seed: Date.now() % 1000003 })

    // The controller's lines, synced only; anything else (plain text, loading, instrumental, none,
    // error) gives no words.
    function lyrics() {
        return { state: controller.state, synced: controller.synced ? controller.lines : [] };
    }

    function syncTrack() {
        lyricWords.setTrack(controller.trackKey, controller.duration);
        // A new track drops the lyrics; a refresh of the same song keeps the controller's lines.
        lyricWords.setLyrics(lyrics());
    }

    // The controller's playback clock: it extrapolates from its last anchor, as the module does.
    // Its four anchor properties change one by one, so they're read once they all have.
    function readAnchor() {
        lyricWords.read({
            position: controller.anchorPosition,
            wall: controller.anchorWall,
            rate: controller.anchorRate,
            playing: controller.anchorPlaying
        });
    }

    LyricsSubscription {}

    Connections {
        target: root.controller
        function onTrackKeyChanged() { root.syncTrack(); }
        function onDurationChanged() { root.lyricWords.setTrack(root.controller.trackKey, root.controller.duration); }
        function onLinesChanged() { root.lyricWords.setLyrics(root.lyrics()); }
        function onSyncedChanged() { root.lyricWords.setLyrics(root.lyrics()); }
        function onStateChanged() { root.lyricWords.setLyrics(root.lyrics()); }
        function onAnchorPositionChanged() { Qt.callLater(root.readAnchor); }
        function onAnchorWallChanged() { Qt.callLater(root.readAnchor); }
        function onAnchorRateChanged() { Qt.callLater(root.readAnchor); }
        function onAnchorPlayingChanged() { Qt.callLater(root.readAnchor); }
    }

    Component.onCompleted: {
        syncTrack();
        if (controller.anchorWall > 0)
            readAnchor();
    }

    FrameAnimation {
        running: true
        onTriggered: {
            const next = root.lyricWords.words(Date.now());
            if (next.length > 0 || root.words.length > 0)
                root.words = next;
        }
    }
}

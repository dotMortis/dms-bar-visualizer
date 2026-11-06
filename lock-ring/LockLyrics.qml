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

    // The Lyric Words visible this frame (lyric-words.mjs words()), by their id (wordId()).
    property var current: ({})
    // The same words as a model, one entry (wordId, text) per word for as long as it keeps its
    // text and its spot: LockRing.qml draws one delegate per entry, so a word keeps its drawing
    // from popping in to dissolving while others come and go around it.
    readonly property alias wordModel: wordModel
    // Whether the rings draw slowly (LockAudio.slow): the words are stepped by LockAudio then.
    property bool slow: false

    // A Kick the shared pipeline found just now, with its power: a word landing with it pops harder.
    function kick(power) {
        tracker.kick(power, Date.now());
    }

    readonly property var controller: LyricsService.controller
    // The Lyric Words module (lyric-words.mjs createLyricWords()). Placement varies from lock to lock.
    readonly property var tracker: LyricWords.createLyricWords({ placement: "ribbons-or-hands", seed: Date.now() % 1000003 })

    // The controller's lines, synced only; anything else (plain text, loading, instrumental, none,
    // error) gives no words.
    function lyrics() {
        return { state: controller.state, synced: controller.synced ? controller.lines : [] };
    }

    // The controller's track and lines, into the module. Called once for any batch of changes to
    // them: a new track drops the lyrics, and the same Lyric Lines again (a refresh) keep the words.
    function syncTrack() {
        tracker.setTrack(controller.trackKey, controller.duration);
        tracker.setLyrics(lyrics());
    }

    // The controller's playback clock: it extrapolates from its last anchor, as the module does.
    // Its four anchor properties change one by one, so they're read once they all have.
    function readAnchor() {
        tracker.read({
            position: controller.anchorPosition,
            wall: controller.anchorWall,
            rate: controller.anchorRate,
            playing: controller.anchorPlaying
        });
    }

    // A word's id in the model: its key, text and spot. A seek or new lyrics can bring a key back
    // with another word or elsewhere, and that word gets a fresh drawing.
    function wordId(word) {
        return [word.key, word.text, JSON.stringify(word.spot)].join("|");
    }

    // This frame's words, into `current` and the model.
    function syncWords() {
        const shown = tracker.words(Date.now());
        const byId = {};
        for (const word of shown)
            byId[wordId(word)] = word;
        const have = {};
        for (let i = wordModel.count - 1; i >= 0; i--) {
            const id = wordModel.get(i).wordId;
            if (byId[id])
                have[id] = true;
            else
                wordModel.remove(i);
        }
        for (const id in byId) {
            if (!have[id])
                wordModel.append({ wordId: id, text: byId[id].text });
        }
        if (shown.length > 0 || Object.keys(current).length > 0)
            current = byId;
    }

    LyricsSubscription {}

    ListModel {
        id: wordModel
    }

    Connections {
        target: root.controller
        function onTrackKeyChanged() { Qt.callLater(root.syncTrack); }
        function onDurationChanged() { Qt.callLater(root.syncTrack); }
        function onLinesChanged() { Qt.callLater(root.syncTrack); }
        function onSyncedChanged() { Qt.callLater(root.syncTrack); }
        function onStateChanged() { Qt.callLater(root.syncTrack); }
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

    // Every frame, unless the rings draw slowly in Silence (LockAudio.slow, set by LockAudio):
    // then LockAudio steps the words on its slow frame.
    FrameAnimation {
        running: !root.slow
        onTriggered: root.syncWords()
    }
}

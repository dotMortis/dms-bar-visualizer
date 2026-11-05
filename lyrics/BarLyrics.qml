// The Bar Visualizer's Lyric Words, apart from drawing them: asks DMS for the Active Player's
// lyrics over the DMS socket (ADR 0006) and times the Lyric Line itself, from the player's MPRIS
// position, through docs/lyric-words.mjs. One for the whole shell, so every screen shows the same
// words at the same spots; LyricWordsLayer.qml draws them on each.
//
// The socket ($XDG_RUNTIME_DIR/dms-<pid>.sock) speaks newline-delimited JSON. On connect DMS sends
// a hello, { apiVersion, capabilities }; with "lyrics" among the capabilities we send
// { id, method: "lyrics.get", params: { title, artist, album, duration (whole seconds),
// fileUrl ("file://..." or ""), providers, allowNetwork } } and get { id, result } or { id, error },
// the result { found, synced, plain, instrumental, voices, ... }. Like DMS's own lyrics controller
// (Services/LyricsController.qml) it asks cache-only first, then with network if that found nothing.
// No DMS, a DMS without lyrics, or any error means no lyrics, and nothing is logged: the socket is
// only opened once a live DMS is found, since Quickshell logs failed connections.
//
//   BarLyrics {
//       enabled: config.lyrics
//       player: audio.activePlayer
//   }
//   kick(power)    feed it each Kick, with its power
//   words          a ListModel of the words shown: wordId, text, ribbon, spotX (0..1 across the bar)
//   current        wordId -> the word's state this frame (docs/lyric-words.mjs words())
import QtQuick
import Quickshell
import Quickshell.Io
import "../docs/lyric-words.mjs" as LyricWords

Scope {
    id: root

    property bool enabled: true
    property var player: null

    readonly property alias words: wordModel
    property var current: ({})

    // DMS's own lyrics providers, in its default order (Common/settings/SettingsSpec.js
    // mediaLyricsProviders). We don't read DMS's settings, so the user's own choice there isn't
    // followed; any provider DMS doesn't know is skipped by it.
    readonly property var providers: ["betterlyrics", "unison", "lyricsplus", "kugou", "lrclib", "youtubemusic"]

    readonly property var tracker: LyricWords.createLyricWords({
        placement: "ribbons",
        seed: Date.now() % 2147483647
    })

    // The Active Player's track: who, what, and how long.
    readonly property string fileUrl: {
        const url = player?.metadata?.["xesam:url"] ?? "";
        return typeof url === "string" && url.startsWith("file://") ? url : "";
    }
    readonly property string trackKey: player ? JSON.stringify([player.dbusName ?? "", player.trackTitle ?? "", player.trackArtist ?? "", player.trackAlbum ?? "", fileUrl]) : ""
    readonly property real trackLength: player && player.lengthSupported ? player.length : 0

    // The DMS socket: found, connected, and its hello lists lyrics.
    property bool capable: false
    property int nextId: 1
    property var pending: ({})   // request id -> callback(response)
    property int serial: 0       // bumped per track, so a late reply for another track is dropped

    function kick(power) {
        if (enabled)
            tracker.kick(power, Date.now());
    }

    function read() {
        if (!player)
            return;
        tracker.read({
            position: player.positionSupported ? player.position : 0,
            wall: Date.now(),
            rate: player.rate,
            playing: player.isPlaying
        });
    }

    function trackChanged() {
        serial++;
        pending = {};
        tracker.setTrack(trackKey, trackLength);
        read();
        if (enabled)
            requestDelay.restart();
    }

    function send(method, params, callback) {
        const id = nextId++;
        pending[id] = callback;
        socket.write(JSON.stringify({ id, method, params }) + "\n");
        socket.flush();
    }

    // Cache-only first, then with network if that found nothing, as DMS does.
    function request() {
        if (!enabled || !capable || !player)
            return;
        const title = player.trackTitle ?? "", artist = player.trackArtist ?? "";
        if ((!title || !artist) && !fileUrl)
            return;
        const query = {
            title,
            artist,
            album: player.trackAlbum ?? "",
            duration: Math.round(trackLength),
            fileUrl,
            providers
        };
        const token = serial;
        const lookup = allowNetwork => send("lyrics.get", Object.assign({ allowNetwork }, query), response => {
            if (token !== serial)
                return;
            const result = response.error ? null : response.result;
            const found = !!result?.found && (result.instrumental || (result.synced ?? []).length > 0 || (result.plain ?? "").trim() !== "");
            if (!found && !allowNetwork) {
                lookup(true);
                return;
            }
            tracker.setLyrics(found ? result : null);
        });
        lookup(false);
    }

    function receive(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch (e) {
            return;
        }
        if (!message || typeof message !== "object")
            return;
        if (message.id === undefined) {
            if (Array.isArray(message.capabilities)) {
                capable = message.capabilities.includes("lyrics");
                request();
            }
            return;
        }
        const callback = pending[message.id];
        if (!callback)
            return;
        delete pending[message.id];
        try {
            callback(message);
        } catch (e) {
            tracker.setLyrics(null);
        }
    }

    // The words shown, into the model: one entry per word while it keeps its text and its spot.
    // A seek or new lyrics can bring a word's key back elsewhere, so the spot is in the entry's id.
    function syncWords() {
        const shown = enabled ? tracker.words(Date.now()) : [];
        const byId = {};
        for (const word of shown)
            byId[[word.key, word.text, word.spot.ribbon, word.spot.x].join("|")] = word;
        const have = {};
        for (let i = wordModel.count - 1; i >= 0; i--) {
            const id = wordModel.get(i).wordId;
            if (byId[id])
                have[id] = true;
            else
                wordModel.remove(i);
        }
        for (const id in byId) {
            const word = byId[id];
            if (!have[id])
                wordModel.append({ wordId: id, text: word.text, ribbon: word.spot.ribbon, spotX: word.spot.x });
        }
        current = byId;
    }

    onTrackKeyChanged: trackChanged()
    onTrackLengthChanged: tracker.setTrack(trackKey, trackLength)
    onEnabledChanged: {
        serial++;
        pending = {};
        if (enabled) {
            if (!socket.connected)
                finder.running = true;
            request();
        } else {
            tracker.setLyrics(null);
            syncWords();
        }
    }

    Connections {
        target: root.player
        ignoreUnknownSignals: true
        function onIsPlayingChanged() { root.read(); }
        function onRateChanged() { root.read(); }
        function onPositionChanged() { root.read(); }
    }

    ListModel {
        id: wordModel
    }

    // Metadata often arrives a piece at a time on a track change; ask once it has settled.
    Timer {
        id: requestDelay
        interval: 400
        onTriggered: root.request()
    }

    // The MPRIS position: Quickshell's reading is extrapolated, re-read it now and then so a seek
    // from elsewhere is caught.
    Timer {
        interval: 1000
        repeat: true
        running: root.enabled && root.player !== null
        onTriggered: root.read()
    }

    FrameAnimation {
        running: root.enabled || wordModel.count > 0
        onTriggered: root.syncWords()
    }

    // The newest dms-<pid>.sock whose DMS is alive, or nothing.
    Process {
        id: finder
        command: ["sh", "-c", `for s in $(ls -t "$XDG_RUNTIME_DIR"/dms-*.sock 2>/dev/null); do p=\${s##*/dms-}; p=\${p%.sock}; [ -S "$s" ] && kill -0 "$p" 2>/dev/null && { echo "$s"; exit 0; }; done; exit 0`]
        stdout: StdioCollector {
            onStreamFinished: {
                const path = text.trim();
                if (path === "")
                    return;
                socket.path = path;
                socket.connected = true;
            }
        }
    }

    // Look for DMS again while it is away (not started yet, or restarted).
    Timer {
        interval: 15000
        repeat: true
        running: root.enabled && !socket.connected
        onTriggered: finder.running = true
    }

    Socket {
        id: socket
        connected: false
        onConnectionStateChanged: {
            if (connected)
                return;
            root.capable = false;
            root.pending = {};
        }
        parser: SplitParser {
            onRead: line => root.receive(line)
        }
    }

    Component.onCompleted: {
        trackChanged();
        finder.running = enabled;
    }
}

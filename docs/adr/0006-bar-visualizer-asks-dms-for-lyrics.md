# The Bar Visualizer asks DMS's socket for lyrics

The Bar Visualizer stays outside DMS ([ADR 0001](0001-lock-ring-runs-inside-dms.md)), so it can't use DMS's `LyricsService` the way the Lock Ring does. It sends DMS the same `lyrics.get` request DMS's own widgets send, over the DMS socket (`$XDG_RUNTIME_DIR/dms-<pid>.sock`), and gets back the same timed lyrics. DMS only answers with the lyrics, not which line is being sung, so the bar works out the Lyric Line and its Lyric Words itself from the Active Player's playback position. This is the Bar Visualizer's first dependency on DMS at runtime: without a running DMS v2.0 or later it shows no lyrics, but everything else works as before.

## Considered Options

- **Read DMS's lyrics cache (`~/.cache/dms/lyrics/`) directly**: rejected. The file names are hashes of a key that includes a version number DMS changes between releases (v5 installed, v6 upstream), and the cache only has songs DMS has already looked up.
- **Fetch lyrics from LRCLIB ourselves**: rejected. It duplicates what DMS already does, and has fewer providers and less word timing than DMS.

## Consequences

The socket's request format is not a public API, so a DMS update can break the bar's lyrics. Both visualizers decide for themselves whether to show lyrics, with their own switches in `config.json`, and ignore DMS's own Lyrics setting. So with lyrics on, they send the track's title, artist and album to DMS's lyrics providers even when the user has turned lyrics off in DMS.

# The Lock Ring loads a native QML module inside DMS

The Lock Ring has to run in DMS's own process ([ADR 0001](0001-lock-ring-runs-inside-dms.md)), so its per-frame work can't move to a process of its own. It ships the same compiled module as the Bar Visualizer ([ADR 0007](0007-no-script-in-the-per-frame-hot-path.md)) in its plugin directory and imports it as a local directory (`import "native"`). That works with no DMS patch or environment change, because DMS loads plugin QML from `file://` URLs.

## Considered Options

- **Only QML and shaders, with the per-frame math moved into `ring.frag`**: rejected. No crash risk, but the Hands and the Lyric Words layout don't fit a fragment shader, so the JS would stay.
- **A helper process that sends the results to QML**: rejected. QML would still parse and pass on every value each frame, so little is gained.
- **An identified module via `QML_IMPORT_PATH`**: rejected. That needs a systemd drop-in for `dms.service`, which a plugin can't count on.

## Consequences

A crash in the module takes down the whole DMS shell, lock screen included. That is new: up to now the Lock Ring could only break itself. So the core never panics across the C ABI and never allocates per frame. The module uses public Qt API only, so it survives Qt minor updates, but it is built against the installed Qt. A loaded `.so` can't be unloaded, so a new version needs a DMS restart, not just a plugin reload. If our own audio capture ever replaces cava, the Lock Ring gets an audio thread inside DMS, under the same rules.

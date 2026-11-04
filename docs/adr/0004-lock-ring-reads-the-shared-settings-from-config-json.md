# The Lock Ring reads the settings it shares with the bar from the bar's config.json

The Lock Ring had its own copy of every setting the Bar Visualizer has (intensity, speed, the kick settings, bass stretch) in DMS's plugin settings, so the two had to be tuned twice and drifted apart. Now the Lock Ring reads those from the Bar Visualizer's `~/.config/bar-visualizer/config.json`, watched like the bar watches it, and its DMS settings page keeps only its own settings (hand waves, ring size). The defaults of the shared settings live once, in `docs/config.mjs`, which the bar, the audio pipeline, the Lock Ring and the demo all import. This replaces ADR 0001's "it keeps its own settings in DMS's plugin settings" for the shared settings.

## Considered Options

- **Share only the audio settings (speed, kick), keep intensity and bass stretch per visualizer**: rejected. The user wanted no setting in two places, and the look settings mean the same on both.
- **Keep separate settings and only define the defaults once**: rejected, as it leaves the user tuning the same kick range twice.

## Consequences

The Lock Ring now depends on a file the Bar Visualizer owns. It only reads it and never creates or writes it, so without the Bar Visualizer it runs on the defaults until the user writes the file by hand. If `~/.config/bar-visualizer/` doesn't exist when DMS starts, the file isn't watched until `dms restart`. Values an older Lock Ring stored for the shared settings in `plugin_settings.json` are ignored. ADR 0002 still holds for the Lock Ring's own settings.

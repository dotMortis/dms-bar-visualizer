# Both visualizers read their settings from one config.json

The Lock Ring had its own copy of every setting the Bar Visualizer has (intensity, speed, the kick settings, bass stretch) in DMS's plugin settings, so the two had to be tuned twice and drifted apart. Now there is one settings file for both, the Bar Visualizer's `~/.config/bar-visualizer/config.json`. The Lock Ring reads every setting in it that applies to a ring, and keeps its own (hand waves, ring size) in its `lockRing` section. It has no settings page in DMS any more. The defaults of every key live once, in `docs/config.mjs`, which the bar, the audio pipeline, the Lock Ring and the demo all import.

This reverses two requirements from the Lock Ring's spec: #10's "It does **not** read the bar's `config.json`", and #16's acceptance criterion "Removing or changing the Bar Visualizer's config has no effect on the Lock Ring". It replaces ADR 0001's "it keeps its own settings in DMS's plugin settings".

## Considered Options

- **Share only the settings both have, keep the Lock Ring's own in DMS**: rejected. The user wanted one place for every setting, not two places split by which visualizer has them.
- **Keep the DMS settings page, writing to `config.json`**: rejected. The page would be a second writer of a file the user edits by hand, and a save could overwrite an edit.
- **Keep separate settings and only define the defaults once**: rejected, as it leaves the user tuning the same kick range twice.

## Consequences

The Lock Ring depends on a file the Bar Visualizer owns. It only reads it and never creates or writes it, so without the Bar Visualizer it runs on the defaults until the user writes the file by hand. If `~/.config/bar-visualizer/` doesn't exist when DMS starts, the file isn't watched until `dms restart`. The Bar Visualizer writes the `lockRing` section only into a file it creates, so an older `config.json` has none until the user adds it. Values an older Lock Ring stored in DMS's `plugin_settings.json` are ignored. ADR 0002's one set for every ring still holds, now in `config.json`.

The Lock Ring's own adjustments to the shared settings are percentages of them, so they keep following the bar ([ADR 0005](0005-lock-ring-tunes-shared-settings-as-percentages.md)).

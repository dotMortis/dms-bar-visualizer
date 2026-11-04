# The Lock Ring's settings are plugin-wide, not per widget

DMS stores a desktop plugin's settings per widget, but every Lock Ring draws from one shared audio capture, and Kick detection runs in that capture. Per-widget settings would give two rings different kick thresholds with only one detector to honor them. So the Lock Ring keeps one plugin-wide set of settings in DMS's plugin settings (`plugin_settings.json`, under `lockRing`). Its settings page routes the tweakables there instead of into the widget's config, and the shared capture reads them from there. DMS's own per-widget choices, such as which displays show the widget, stay per widget.

## Considered Options

- **Per-widget settings, with one Kick detector per ring on the shared bands**: rejected. Rings on different monitors could then flash on different hits, while the spec wants every ring to pulse in sync.
- **Per-widget settings for the purely visual tweakables (intensity, bass stretch)**: rejected for now. With a single set, a setting means the same thing on every ring, and the settings page is one list in `lock-ring/settings.mjs`.

## Consequences

Changing a setting from any Lock Ring widget's options changes it for all of them, and the settings page says so. The page works around DMS's per-widget settings service, so DMS changes to how desktop-plugin settings are stored can break it.

The settings the Lock Ring shares with the Bar Visualizer have since moved to the bar's `config.json` ([ADR 0004](0004-lock-ring-reads-the-shared-settings-from-config-json.md)); this decision still holds for its own settings.

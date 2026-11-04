# The Lock Ring runs inside DMS as a desktop plugin

DMS's lock screen is a Wayland session lock owned by the DMS process, and while it is up the compositor shows only that process's lock surfaces. The Bar Visualizer's own Quickshell process can never appear there. So the Lock Ring ships as a DMS `desktop` plugin that the user places on the lock screen as a widget, even though the Bar Visualizer deliberately stays outside DMS. The Lock Ring is installed separately from the Bar Visualizer, with its own scripts and package, and it keeps its own settings in DMS's plugin settings. (Since [ADR 0004](0004-both-visualizers-read-one-config-json.md), it reads all its settings from the Bar Visualizer's `config.json` instead.)

## Considered Options

- **Patch DMS's lock screen**: rejected, because every DMS update would overwrite the patch.
- **Switch to another locker (hyprlock)**: rejected, because it gives up the DMS lock screen.
- **Follow DMS's own lock clock**: rejected. The clock is a separate widget that DMS auto-places based on wallpaper brightness, and a plugin isn't told where it is. The Lock Ring draws its own clock instead.

## Consequences

The Lock Ring depends on DMS's plugin API, so DMS updates can break it in a way they can't break the Bar Visualizer. Kick detection stays shared through `docs/kick.mjs`, so both visualizers detect the same Kicks.

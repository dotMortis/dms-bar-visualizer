# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- `kickThreshold` is now a fraction of the kick range's recent peak instead of a jump on cava's
  0–1 output scale, so it means the same at any volume. The default stays 0.4. Re-tune a value set
  for the old detector, such as 0.2, starting from the default. Also in the demo.
- A kick's shockwave and particles now scale with how hard the hit is next to the recent kicks, so
  accents stand out. At the default threshold, every kick used to get full size. Also in the demo.
- New kick defaults: `kickLowHz` 20 (was 30; cava's lowest band starts at 30 Hz, so this listens
  to the same bands) and `kickCooldown` 0.1 s (was 0.12 s). Also in the demo.
- Demo: the `kickThreshold` slider runs from 0.06 to 0.9 (was 0.02 to 0.8).

### Fixed

- One hit no longer fires two or more kicks as it rings out over a bass note or falls into a lower
  band, or as a long 808 tail rings on. Down to a `kickThreshold` of 0.06, lowering it only makes
  more hits fire. Also in the demo.
- A kick that comes in while the last one still rings, such as a 16th note before the beat, now
  fires. The beat's kick after it used to be skipped. Also in the demo.
- Kicks no longer go missing for many seconds after a louder passage, while cava's
  auto-sensitivity catches up. They come back within about a second, and within 2 s after cava
  restarts. Also in the demo.
- The shockwave lands sooner: a kick no longer waits for a slow rise to clear a fixed jump on
  cava's output. Also in the demo.
- `kickLowHz` / `kickHighHz` now select the bands cava actually puts those frequencies in. Below
  100 Hz they were up to one band off, so the default 30–90 Hz range left out the band 90 Hz lands
  in. Also in the demo.
- Demo: kicks no longer depend on the display's refresh rate. At 120 or 144 Hz it fired on other
  beats than at 60 Hz, so settings tuned there didn't carry over.

## [0.4.1] - 2026-10-29

### Fixed

- A single kick often fired twice, ~130 ms apart: as the kick rang out, its energy moved to a
  lower band and read as a new hit once the cooldown ran out. The kick now re-arms only after the
  whole range has settled. Also in the demo.

## 0.4.0 - 2026-10-29

### Added

- `kickCooldown` sets the minimum time between kicks (default 0.12 s, the previous fixed value).
  `0` removes the limit. Also in the demo.

### Changed

- `kickThreshold` now defaults to 0.4 (was 0.10), tuned for the per-band detection.
- Overlapping kicks no longer cut each other off: a new kick's shockwave and particles play on top
  of the ones still running (up to 8 at once) instead of restarting them. Also in the demo.

### Fixed

- A wide `kickLowHz` / `kickHighHz` range barely fired: the kick averaged all bands in the range,
  so a note hitting one band was drowned out. Each band is now checked on its own and any band
  jumping above its recent level fires the kick.

## 0.3.0 - 2026-10-29

### Added

- `kickLowHz` / `kickHighHz` set the frequency range that fires the kick (shockwave and
  particles). The defaults (30 to 90 Hz) match the previous fixed bass range. Also in the demo.

### Fixed

- Config hot reload: on a first run (no `~/.config/bar-visualizer/` yet) the created file wasn't
  watched until a restart. Removing a key or deleting the file now resets to the defaults right
  away instead of keeping the old values, and an invalid file keeps the last good settings.

## 0.2.1 - 2026-10-29

### Fixed

- After running for hours the ribbons got jerky and changed shape: the ever-growing animation
  time and wave phase lost precision as 32-bit floats in the shader. Both now wrap seamlessly.

## 0.2.0 - 2026-10-29

### Added

- `~/.config/bar-visualizer/config.json` is created with the defaults on first start (and again
  if you delete it, to reset).
- Demo: an "Export config.json" button that downloads the current slider values as a ready-to-use
  settings file.
- The package now reminds you on removal to run `systemctl --user disable --now bar-visualizer`,
  since pacman can't stop a running user service.

### Fixed

- `--uninstall` in both scripts didn't stop a visualizer started by systemd
  (`/usr/bin/qs -c bar-visualizer`), so after a plain `pacman -R` it kept running with its files
  gone.
- Demo: the geometry sliders started at 48/6/14 instead of the real defaults
  (`barThickness` 40, `spacing` 4, `radius` 12).

## 0.1.0 - 2026-10-29

First release.

### Added

- Shader audio visualizer drawn behind the DankMaterialShell top bar on Hyprland: neon spectrum
  ribbons, an energy-driven outward flow, and on every kick a chromatic shockwave plus a spray of
  streaking particles, in Catppuccin Mocha lavender.
- Runs as its own Quickshell config on a click-through `bottom` layer surface, so DMS itself is
  never modified.
- cava input that follows the MPRIS player DankBar shows and captures the output that player
  actually plays to.
- Beat detection that scales the shockwave and particles by the kick's strength.
- Mirrors DMS's maximize detection: drops the gap and rounding together with the bar.
- Settings file at `~/.config/bar-visualizer/config.json`: override any tweakable by key,
  picked up live on save.
- `install-arch.sh`: builds and installs a pacman package (`dms-bar-visualizer-git`) locally with
  `makepkg`. Re-run to update, `--uninstall` to remove.
- `install.sh`: source install for other distros or for hacking on it.
- One-line installs for both scripts (`curl … | bash`).
- PKGBUILD in `packaging/aur/`, ready for the AUR.
- [Live WebGL demo](https://dotmortis.github.io/dms-bar-visualizer/) with a port of the shader,
  driven by a demo beat, a synth loop, the microphone or an audio file, with every tweakable on
  a slider.
- Animated README: an SVG re-creation of the visualizer and a layer diagram, generated by
  `assets/generate.py`.

[Unreleased]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.4.1...HEAD
[0.4.1]: https://github.com/dotMortis/dms-bar-visualizer/releases/tag/v0.4.1

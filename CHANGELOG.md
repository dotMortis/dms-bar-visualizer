# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The Lock Ring shows Lyric Words: the words of the playing song's line, from DMS's lyrics
  service (DMS v2.0+), each landing as it is sung on a Ribbon (about two thirds) or a Hand (about
  one third), glowing in the color there, popping in harder on a Kick, splitting like the
  Digital Time as a Shockwave crosses it, and dissolving with the line. `lockRing.lyrics` in
  `config.json` (default `true`) turns it off.
- The Bar Visualizer shows Lyric Words too: each word of the playing song's line appears as it is
  sung on a Ribbon, the line's first word at a random spot and the rest after it in a row, rides
  its wave gently, glows in its color, pops in harder on a Kick, flares and splits as a Shockwave
  passes, and lingers a moment after the line ends before slowly dissolving, while the next line
  already comes in. The new top-level `lyrics` key in `config.json` (default `true`) turns
  it off.
- The bar's Lyric Words need a running DMS v2.0 or later: the bar asks DMS for the lyrics over
  its socket ([ADR 0006](docs/adr/0006-bar-visualizer-asks-dms-for-lyrics.md)). Without it the
  bar works as before, just without them. With lyrics on, DMS sends the playing track's title,
  artist and album to its lyrics providers, even with DMS's own Lyrics setting off.

### Changed

- The README's animations are animated WebPs now, rendered from the generated SVGs by
  `assets/render.mjs`: the animated SVGs kept a CPU core busy for as long as the page was open.

## [0.9.0] - 2026-11-04

### Added

- The Lock Ring can differ from the bar in brightness and Kicks: `config.json`'s `lockRing`
  section takes `intensityPercent`, `kickLowHzPercent`, `kickHighHzPercent`,
  `kickThresholdPercent` and `kickCooldownPercent`, each a percentage of the bar's setting
  (`100` = the same), so retuning the bar still retunes the ring. The demo's ring view has a
  slider for each.

## [0.8.2] - 2026-11-04

### Changed

- The Lock Ring's ribbons wave only outward from the dial again, never inside it, so the clock
  keeps its room. Their waves are smaller and rounder: the spectrum is smoothed along the ring, so
  a strand no longer kinks where one band jumps from the next, and the treble's ripple fades out
  where a strand touches the dial.
- The Lock Ring's Aura keeps its shape and size, with more intense colors.

## [0.8.1] - 2026-11-04

### Fixed

- The Lock Ring was missing from DMS's widget list in 0.8.0: its Kick module used JavaScript
  syntax (object spread) that Qt's JS engine can't parse, so the plugin failed to load. A new test
  loads every module the QML imports through Qt's own engine, so this can't slip through again.

## [0.8.0] - 2026-11-04

### Changed

- The Lock Ring's ribbons glow softer again, like neon instead of hard lines, and keep a defined
  core. The glow is still measured in pixels, so it looks the same at every ring size; the hands,
  lit like the ribbons, soften with them.
- The Lock Ring's Aura spreads inward from the ribbon as smoothly as outward: it is brightest at
  the ribbon, with no hard inner edge, and its inward reach grows with the music like its outward
  reach. It reaches as far as the ribbon swings, so it fills the swing without crowding the hands
  or the time.
- The Lock Ring's hour points flash when a Kick's Shockwave reaches them instead of at the
  instant of the Kick, so the wave visibly travels out and lights them as it passes, brighter on
  a harder hit. A soft Kick's Shockwave stops short of the ring and leaves them dark. The hands
  still flash on the Kick itself.
- The Lock Ring's ribbons wave like the Bar Visualizer's: with music each strand swings inward and
  outward around the swelling dial, farther when the music is louder, instead of bulging outward
  as a row of lumps. The spectrum is smoothed with a cubic between the bands, so the ribbon has no
  corners, and it passes through 6 and 12 o'clock without a V where the mirrored halves meet. In
  silence the ribbon idles as before.
- The Lock Ring's Shockwaves hit like the Bar Visualizer's Kicks: a wider, softer front in
  lavender, mauve and blue with a brighter wake behind it; the ribbons flare and bulge where the
  front crosses each strand, more on a harder Kick and adding up when Shockwaves overlap, with the
  hour points riding them; and the center punches white-lavender as every Shockwave is born,
  faintly on a soft Kick and strongly on a hard one. Nothing shakes.
- The Lock Ring's digital time takes the Shockwave's hit: as the front crosses it, the digits
  split into lavender, mauve and blue copies pushed outward and flare toward white with a glow,
  faint for a soft Kick and full for a hard one. The digits stay in place, so the time stays
  readable. The demo's ring view shows the same.
- The Lock Ring's Shockwaves are no longer perfect circles: each Kick's front wobbles in its own
  soft lobes and is brighter on one side, and its edge is ragged like a flame front, flickering
  as it travels; it is born round and wobbles more as it goes. A soft Kick's front stays nearly
  round and calm, a hard one's tears wide. Beads of light ride each front in its lavender, mauve
  and blue, spreading apart as the ring grows until it ends as loose points, more and bigger on a
  harder Kick. The ribbons' surge, the hour points and the time follow each front's own shape, on
  every ring alike.
- The Lock Ring's hands are slimmer, and a Kick only pushes them a little instead of whipping
  them: they flash, swing a little and their tips reach a little farther out, the short hour hand
  less than the others.
- The Lock Ring's Aura no longer flashes on Kicks: a Kick pushes the glow around the ribbons a
  little outward and eases it back, without brightening it, while the Shockwave and the ribbons
  take the hit. The Lock Ring has no plasma haze anymore.

## [0.7.1] - 2026-11-04

### Fixed

- Updating with `install-arch.sh` could hang for 90 seconds after pacman's "Cleaning up...": the
  install scripts killed the Bar Visualizer the service runs behind systemd's back, which can
  leave the following `systemctl --user restart` waiting for the stop timeout. `install-arch.sh`
  and `install.sh` now stop only copies started by hand and leave the service to systemd (with
  `--no-service`, they stop it through systemd), and the service's stop timeout is 5 seconds.

## [0.7.0] - 2026-11-04

### Changed

- One settings file for both visualizers: the Lock Ring reads all its settings from the Bar
  Visualizer's `~/.config/bar-visualizer/config.json`. It uses the bar's `intensity`, `speed`,
  `kickThreshold`, `kickDecay`, `kickLowHz`, `kickHighHz`, `kickCooldown` and `bassStretch`, and
  its own `handWaves` and `ringSize` are in the file's new `lockRing` section. Its settings page in
  DMS is gone, and values set there before are ignored: copy any you changed into `config.json`
  (`lockRing.handWaves` and `lockRing.ringSize` are the page's percentages divided by 100). The
  defaults of every key are defined once, in `docs/config.mjs`.
- `config.json` is read the same way by both visualizers: a value of the wrong type falls back to
  its default, and keys the visualizers don't know are ignored.
- Demo: the Lock Ring view's sliders have the names `config.json` has, and **Export config.json**
  downloads the whole file, `lockRing` section included, in both views.
- The Lock Ring's ribbons are as crisp as the Bar Visualizer's: their glow is measured in pixels,
  as on the bar, instead of growing with the ring's size.
- Kicks hit the Lock Ring as hard as the bar: the ribbons widen, swing further and brighten on
  each kick, and the shockwave is brighter and crisper.
- The Lock Ring's hands are lit like its ribbons, so they have the same color intensity: the same
  deep palette and glow instead of a white-hot core, brighter and wider with their band and on a
  kick, and scaled by `intensity` like the rest of the ring. They no longer outshine it.
- Each Lock Ring hand now shows its own band clearly: the hour hand the bass, the minute hand the
  mids, the second hand the highs, each measured against that band's own recent peak (the highs
  are far quieter than the bass, so the second hand barely moved). Each hand's wave also travels
  at its own band's pace instead of the bass's.

## [0.6.0] - 2026-11-04

### Added

- The Lock Ring: a music visualizer for DMS's lock screen, as a DMS desktop plugin (`lockRing`,
  in `lock-ring/`) that you add under Settings → Lock Screen. It's a clock: a living neon ribbon
  is the dial, with 12 glowing hour points riding on it (brighter at 12, 3, 6 and 9), three
  floating hands that don't meet at the center and always point at the true time, with a
  sweeping second hand, and a small `HH:MM` in DMS's lock-screen font and 12h/24h setting.
- The Lock Ring hears the music, from the same Active Player as the Bar Visualizer. Spectrum
  ribbons in the Bar Visualizer's colors grow out of the dial and bulge outward with each band,
  mirrored left and right with bass at the bottom, and the ring swells with the music's energy.
  The hands react too: hour to the bass, minute to the mids, second to the highs. Each is a slim
  neon wave ribbon with a white-hot core that swings wider and glows brighter the louder its band
  is, bending only around a straight line through the center at the true time, so the hands
  always point at the time. In silence the ribbon settles into a thin, faint wave that slowly
  breathes and drifts around the dial, and the hands into calm, thin lines.
- Kicks on the Lock Ring, detected exactly like the Bar Visualizer's: each one sends a chromatic
  shockwave out of the center, sparks fly off the ring, the hands whip, and the hands and hour
  points flash. Harder hits make bigger, brighter shockwaves, and up to 8 kicks play on top of
  each other.
- All Lock Rings on all monitors share one audio capture, so they pulse in sync, and it runs only
  while a Lock Ring is on screen.
- Lock Ring settings in DMS: open a Lock Ring widget's options under Settings → Lock Screen to set
  intensity, speed, kick threshold, kick decay, kick range, kick cooldown, bass stretch, hand
  waves (how far the hands swing, down to straight hands at 0%) and ring size (the widget's
  default size, as a share of the screen height; you can still resize it). The ones the bar has
  too default to the Bar Visualizer's values. They apply right away, and to every Lock Ring at
  once. The Lock Ring never reads the Bar Visualizer's `config.json`.
- Installing the Lock Ring, independently of the Bar Visualizer: either one installs alone, and
  neither's scripts touch the other. On Arch, `install-lock-arch.sh` builds and installs the
  pacman package `dms-lock-visualizer-git` into DMS's system plugin dir; run it again to update.
  Elsewhere, `install-lock.sh` compiles the ring's shader (it needs `qsb` from qt6-shadertools)
  and links `lock-ring/` into your DMS plugin dir. Both take `--uninstall`. The README has a Lock
  Ring section on installing it, adding the widget to the lock screen and moving DMS's password
  field below it.
- Demo: a Lock Ring view, so you can tune the ring without locking the screen. Switch between
  the Bar Visualizer and the Lock Ring at the top of the controls, or open the demo with `#ring`.
  It runs on the same sources (demo beat, synth, microphone, audio file) and draws with the
  plugin's own shader and modules. Its sliders are the plugin's settings, in the units of its
  settings page, plus a 12h/24h toggle, and "Export lockRing settings" downloads the values DMS
  stores for them.

## [0.5.0] - 2026-10-30

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

[Unreleased]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.9.0...HEAD
[0.9.0]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.8.2...v0.9.0
[0.8.2]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.8.1...v0.8.2
[0.8.1]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.7.1...v0.8.0
[0.7.1]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.7.0...v0.7.1
[0.7.0]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/dotMortis/dms-bar-visualizer/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/dotMortis/dms-bar-visualizer/releases/tag/v0.4.1

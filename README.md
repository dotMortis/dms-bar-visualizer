<div align="center">

<a href="https://dotmortis.github.io/dms-bar-visualizer/"><img src="assets/hero.svg" alt="Animated preview of dms-bar-visualizer: neon ribbons, shockwaves and sparks behind a top bar" width="100%"></a>

<br>

**A shader-based audio visualizer that lives behind the top bar of [DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell) on Hyprland.**

[![Hyprland](https://img.shields.io/badge/Hyprland-89b4fa?style=for-the-badge&logo=hyprland&logoColor=11111b)](https://hyprland.org)
[![Quickshell](https://img.shields.io/badge/Quickshell-cba6f7?style=for-the-badge)](https://quickshell.org)
[![Catppuccin Mocha](https://img.shields.io/badge/Catppuccin-Mocha-b4befe?style=for-the-badge&labelColor=1e1e2e)](https://catppuccin.com)
[![Live demo](https://img.shields.io/badge/Live_demo-WebGL-f5c2e7?style=for-the-badge&labelColor=1e1e2e)](https://dotmortis.github.io/dms-bar-visualizer/)
[![Release](https://img.shields.io/github/v/release/dotMortis/dms-bar-visualizer?style=for-the-badge&color=89b4fa&labelColor=1e1e2e)](CHANGELOG.md)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5c2e7?style=for-the-badge&labelColor=1e1e2e)](LICENSE)

</div>

Neon ribbons shaped by the spectrum, waves pushed outward by the music's energy, and on every kick a chromatic shockwave plus a spray of streaking particles, all in Catppuccin Mocha lavender.

It runs as its own small [Quickshell](https://quickshell.org) config. DMS itself isn't modified, so DMS updates can't break it.

For the lock screen, there's the separately installed [Lock Ring](#lock-ring): the same look as a ring around a clock.

> [!NOTE]
> The preview above is an SVG re-creation of `shaders/viz.frag` driven by a synthetic 120 bpm loop. For the real shader, try the **[live WebGL demo](https://dotmortis.github.io/dms-bar-visualizer/)**: it runs on a demo beat, a synth loop, your microphone or an audio file, with every tweakable on a slider.

## How it works

<p align="center"><img src="assets/layers.svg" alt="Layer diagram: the transparent DankBar on the top layer, the visualizer on the bottom layer, the wallpaper below" width="720"></p>

- **Layering:** a click-through Wayland layer surface on the `bottom` layer, sized and inset exactly like the DankBar. The DMS bar draws on the `top` layer, so with a transparent bar background the visualizer shows through.
- **Audio:** [cava](https://github.com/karlstav/cava) provides 32 frequency bands at 60 fps with light smoothing, so transients punch.
- **Follows the active player:** it tracks the MPRIS player DankBar shows (same selection rules) and captures the monitor of whichever output *that* player's stream plays to. Spotify on Bluetooth while the default output is HDMI just works. With no player, it falls back to the newest playing stream, then the default output.
- **Beat detection:** any band in the kick range (`kickLowHz` to `kickHighHz`) jumping above its recent level by `kickThreshold` of the range's recent peak fires a kick, at any volume. Down to 0.06, each hit fires once. Lower values catch softer kicks, and from about 0.15 down bass notes too. Harder hits get bigger shockwaves, and up to 8 play at once.
- **Matches DMS's maximize detection:** with a maximized window on a monitor's active workspace, the visualizer drops its gap and rounding together with the bar.

## Requirements

- Hyprland
- DankMaterialShell (top bar; 2.x for the Lock Ring)
- PipeWire or PulseAudio

On Arch:

```sh
sudo pacman -S --needed quickshell cava libpulse qt6-shadertools
```

## Install

There are two parts, and you can install either one alone or both:

- the **Bar Visualizer**, behind the top bar: its own Quickshell config, started by a systemd user service
- the **[Lock Ring](#lock-ring)**, on the lock screen: a DMS plugin

Installing or removing one never touches the other. After installing, [set it up](#set-up).

> [!TIP]
> Piping a script from the internet into `bash` runs it without showing it to you. The scripts are short; read them first ([install-arch.sh](install-arch.sh), [install-lock-arch.sh](install-lock-arch.sh), [install.sh](install.sh), [install-lock.sh](install-lock.sh)) if you like.

### Arch Linux (recommended)

Each part is a real pacman package, built from [`packaging/aur`](packaging/aur) with `makepkg`, so pacman tracks every file:

```sh
# Bar Visualizer
curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install-arch.sh | bash
# Lock Ring
curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install-lock-arch.sh | bash
```

Or from a clone: `git clone https://github.com/dotMortis/dms-bar-visualizer && cd dms-bar-visualizer`, then `./install-arch.sh` and/or `./install-lock-arch.sh`.

Run a script again to update its part to the latest commit.

`install-arch.sh` builds `dms-bar-visualizer-git`. It:

1. installs `base-devel` and `git` if they're missing, and pulls in dependencies through pacman
2. installs to `/usr/share/dms-bar-visualizer` and registers the Quickshell config as `bar-visualizer`
3. cleans up a previous `install.sh` setup, which would otherwise shadow the package
4. enables the systemd user service (skip with `--no-service`, then run `qs -c bar-visualizer`)

`install-lock-arch.sh` builds `dms-lock-visualizer-git`, which installs the plugin into DMS's system plugin dir, `/etc/xdg/quickshell/dms-plugins/lockRing`. It also removes a link left by `install-lock.sh`, which would otherwise shadow the package. After an update, run `dms restart`.

### Other distros, or hacking on it

**Bar Visualizer:**

```sh
curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install.sh | bash
```

Piped like this, it checks the repo out to `~/.local/share/dms-bar-visualizer` (or updates it there) and runs from that checkout. To hack on it, clone wherever you like and run `./install.sh` from there instead. The script:

1. compiles the shader
2. symlinks the repo to `~/.config/quickshell/bar-visualizer`
3. enables a systemd user service that starts with your graphical session

Use `--no-service` to skip autostart and run it yourself with `qs -c bar-visualizer`.

**Lock Ring:** it needs a clone. `install-lock.sh` can't be piped.

```sh
git clone https://github.com/dotMortis/dms-bar-visualizer && cd dms-bar-visualizer
./install-lock.sh
```

It compiles the ring shader, so it needs `qsb` (on Arch: `qt6-shadertools`), and links `lock-ring/` into your DMS plugin dir (`~/.config/dms/plugins/lockRing`). Edits in the checkout then go live after `dms restart`.

### Uninstall

Every script takes `--uninstall`. Piped, it goes after `bash -s --`:

```sh
curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install-arch.sh | bash -s -- --uninstall        # Bar Visualizer, Arch package
curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install.sh | bash -s -- --uninstall             # Bar Visualizer, source install
curl -fsSL https://raw.githubusercontent.com/dotMortis/dms-bar-visualizer/main/install-lock-arch.sh | bash -s -- --uninstall   # Lock Ring, Arch package
./install-lock.sh --uninstall                                                                                                 # Lock Ring, from its clone
```

After removing the Lock Ring, run `dms restart` so DMS drops it.

## Set up

### Set up the Bar Visualizer

1. **Make the bar transparent:** **DMS Settings → Dank Bar → Transparency = 0**. The visualizer draws behind the bar, so an opaque bar hides it.
2. **Match the bar's geometry:** set `barThickness`, `spacing` and `radius` in `~/.config/bar-visualizer/config.json` to your DankBar's (see [Configuration](#configuration)). The file appears on first start. `hyprctl layers` shows the `dms:bar` surface, whose height is `barThickness + spacing`.
3. **Check it runs:** play some music. It should move behind the bar. If it doesn't, run `systemctl --user status bar-visualizer`, or see [Troubleshooting](#troubleshooting).

### Set up the Lock Ring

1. **Enable it:** the Lock Ring is a desktop plugin, so DMS loads it on its own, with no toggle. If it doesn't show up under **DMS Settings → Plugins**, restart DMS: `dms restart`.
2. **Add the widget:** **DMS Settings → Lock Screen → Add widget → Lock Ring**.
3. **Move the password field:** the ring and DMS's password field both start in the centre of the screen. Under **DMS Settings → Lock Screen → Edit widgets**, drag the password field below the ring. You can move and resize the ring there too.
4. **Check it runs:** play some music and lock the screen. Its settings are under the widget's options in **Settings → Lock Screen** (see [Lock Ring settings](#lock-ring-settings)).

## Configuration

Settings live in `~/.config/bar-visualizer/config.json`. The visualizer creates it with the defaults on first start (and again if you delete it, which resets everything). Keys you remove from it fall back to their default. The visualizer picks up changes as soon as you save, no restart needed.

```json
{
  "barThickness": 44,
  "spacing": 6,
  "intensity": 1.2
}
```

| Property | Default | What it does |
| --- | --- | --- |
| `barThickness` | `40` | DankBar body height. It depends on DMS inner padding and font/icon scale. |
| `spacing` | `4` | DMS bar *spacing* (the gap around the bar) |
| `radius` | `12` | DMS corner radius |
| `followMaximize` | `true` | Mirror DMS's *maximize detection* |
| `intensity` | `1.0` | Overall brightness |
| `speed` | `1.0` | Animation speed |
| `kickThreshold` | `0.4` | How far a band must jump above its recent level to fire a kick, as a fraction (0 to 1) of the kick range's recent peak. Lower = more kicks |
| `kickDecay` | `6.0` | Higher = shorter impact |
| `kickLowHz` | `20` | Bottom of the frequency range that fires the kick (shockwave and particles) |
| `kickHighHz` | `90` | Top of that range. Raise both to hit on snares or claps instead of the kick drum |
| `kickCooldown` | `0.1` | Minimum seconds between kicks, scaled by `speed`. `0` = no limit |
| `bassStretch` | `1.4` | Above 1 spreads the bass (centre) wider, so it isn't hidden under centre widgets |

To find the right geometry, run `hyprctl layers`. The `dms:bar` surface height equals `barThickness + spacing`.

The defaults themselves live in the `Tweakables` block at the top of `shell.qml`. If the file is half-written or not valid JSON, the visualizer keeps its last good settings.

Want to tune by eye first? The [live demo](https://dotmortis.github.io/dms-bar-visualizer/) has a slider for every key.

### Shader

The look lives in `shaders/viz.frag`: palette, ribbons, shockwave and particles. After editing it, recompile with `./install.sh --no-service` or:

```sh
/usr/lib/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 -o shaders/viz.frag.qsb shaders/viz.frag
```

Then restart the visualizer (`systemctl --user restart bar-visualizer`). Qt caches the compiled shader for the life of the process, so hot reload doesn't pick it up.

To change colours, edit the `palette()` cycle and the `LAVENDER` / `MAUVE` / `PINK` / `BLUE` constants.

### README animations and demo

The SVGs in `assets/` are generated. After tweaking `assets/generate.py`, run `python3 assets/generate.py`.

`docs/index.html` is the live demo (served by GitHub Pages). It carries a GLSL ES port of `shaders/viz.frag`, so mirror shader changes there. Its Lock Ring view needs no mirroring: it fetches the ring's own shader and converts it to GLSL ES as the page loads (`docs/webgl.mjs`), and imports the plugin's modules. Those files (`ring.frag` and the ring's `.mjs` modules) live in `docs/lock-ring/`, because Pages publishes only `docs/` and doesn't follow symlinks, and `lock-ring/` links to them, as it does to `docs/kick.mjs`. Edit them there.

Kick detection isn't mirrored: `docs/kick.mjs` is the one detector, and both the visualizer's audio pipeline (`audio/AudioPipeline.qml`) and the demo import it. It lives in `docs/` because Pages publishes only that directory. Browsers don't load module scripts over `file://`, so to run the demo locally, serve the directory and open http://localhost:8000:

```sh
python3 -m http.server -d docs
```

### Kick detection tests

A replay suite holds the kick detector to account. It plays real cava output, recorded from synthesized tracks with known kick onsets, through `docs/kick.mjs` and fails when a track gets more missed, doubled or stray kicks, or a later median kick, than its budget allows. It needs nothing but node, no install:

```sh
node --test
```

It prints those numbers per track for the default and a sensitive kick setting. Other tests check that the kicks and their power don't depend on the volume, and that kicks come back soon after a 12 dB drop and after a cava restart. A sine sweep recorded the same way checks that `kickLowHz` and `kickHighHz` select the bands cava puts those frequencies in. `tests/fixtures/record.py` synthesizes and records the tracks; its header says how to re-record them or add one (needs cava, numpy and real time).

## Lock Ring

The Bar Visualizer can't show on the lock screen: while it's up, only DMS's own surfaces are visible. The **Lock Ring** is a separate DMS plugin for the lock screen: the same ribbons and colours bent into a circle that is the dial of an analog and digital clock, with 12 hour points riding on it and floating hands that react to the music but always show the true time. In silence the ribbon keeps breathing as a thin, faint wave. It follows the active player and detects kicks with the same `docs/kick.mjs` as the bar, and every monitor's ring runs from one capture. ([Why it's a plugin](docs/adr/0001-lock-ring-runs-inside-dms.md).)

To install it and set it up, see [Install](#install) and [Set up the Lock Ring](#set-up-the-lock-ring).

### Lock Ring settings

Its settings are in DMS's plugin settings, under the widget's options in Settings → Lock Screen. They apply right away and to every Lock Ring at once, since all rings share one capture ([why](docs/adr/0002-lock-ring-settings-are-plugin-wide.md)). It doesn't read the Bar Visualizer's `config.json`. The ones the bar has too default to the Bar Visualizer's values:

| Setting | Key | Default | What it does |
| --- | --- | --- | --- |
| Intensity | `intensity` | `100 %` | Overall brightness of the ring |
| Speed | `speed` | `100 %` | Animation speed |
| Kick threshold | `kickThreshold` | `40 %` | How sharply the kick range must jump, as a share of its recent peak. Lower = more kicks |
| Kick decay | `kickDecay` | `60` | How fast a kick's flash fades, in tenths. Higher = shorter |
| Kick range from | `kickLowHz` | `20 Hz` | The lowest frequency the kick listens to |
| Kick range to | `kickHighHz` | `90 Hz` | The highest frequency the kick listens to |
| Kick cooldown | `kickCooldown` | `100 ms` | Shortest time between two kicks. `0` = no limit |
| Bass stretch | `bassStretch` | `140 %` | Spreads the bass over more of the ring. `100 %` = linear |
| Hand waves | `handWaves` | `100 %` | How far the hands swing with the music and on kicks. `0 %` = straight hands. Lock Ring only |
| Ring size | `ringSize` | `40 %` | The widget's default size, as a share of the screen height (20 to 80 %). Resizing the widget under Edit widgets still works. Lock Ring only |

DMS stores each as the integer its slider shows, under `lockRing` in `plugin_settings.json`.

To tune it without locking the screen, open the [live demo's Lock Ring view](https://dotmortis.github.io/dms-bar-visualizer/#ring). Its sliders are these settings, in the same units.

> [!NOTE]
> DMS keeps a loaded plugin in memory, so after updating the Lock Ring (with either script, or by pulling the checkout), restart DMS to see the new version: `dms restart`.

> [!IMPORTANT]
> `install-lock.sh` links the checkout, but the compiled shader (`ring.frag.qsb`) is built once, at install. If you ran it from a checkout that later gets updated, such as the Bar Visualizer installer's `~/.local/share/dms-bar-visualizer`, run `install-lock.sh` from it again after the update so the shader is recompiled, then `dms restart`.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Releases are tagged on [GitHub](https://github.com/dotMortis/dms-bar-visualizer/releases).

## Limitations

- **Top bar only:** bottom and side bars aren't supported yet.
- **One geometry for all screens:** a single bar geometry applies to every screen, and the visualizer shows on every monitor even if DankBar is disabled on some.
- **Player switching:** DMS doesn't expose which player it displays, so the visualizer re-implements the same rules. If you switch players by hand in the DMS media popout, the visualizer won't follow.

## Troubleshooting

- **Nothing moves:** check `pgrep -a cava` and `cat $XDG_RUNTIME_DIR/bar-visualizer-cava.conf`. The `source=` line should be the `.monitor` of the output you hear audio from.
- **Logs:**
  - with the service: `journalctl --user -u bar-visualizer -f`
  - started by hand: run `qs -c bar-visualizer` in a terminal and watch its output

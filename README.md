<div align="center">

<a href="https://dotmortis.github.io/dms-bar-visualizer/"><img src="assets/hero.svg" alt="Animated preview of dms-bar-visualizer: neon ribbons, shockwaves and sparks behind a top bar" width="100%"></a>

<br>

**A shader-based audio visualizer that lives behind the top bar of [DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell) on Hyprland.**

[![Hyprland](https://img.shields.io/badge/Hyprland-89b4fa?style=for-the-badge&logo=hyprland&logoColor=11111b)](https://hyprland.org)
[![Quickshell](https://img.shields.io/badge/Quickshell-cba6f7?style=for-the-badge)](https://quickshell.org)
[![Catppuccin Mocha](https://img.shields.io/badge/Catppuccin-Mocha-b4befe?style=for-the-badge&labelColor=1e1e2e)](https://catppuccin.com)
[![Live demo](https://img.shields.io/badge/Live_demo-WebGL-f5c2e7?style=for-the-badge&labelColor=1e1e2e)](https://dotmortis.github.io/dms-bar-visualizer/)
[![License: MIT](https://img.shields.io/badge/License-MIT-f5c2e7?style=for-the-badge&labelColor=1e1e2e)](LICENSE)

</div>

Neon ribbons shaped by the spectrum, waves pushed outward by the music's energy, and on every kick a chromatic shockwave plus a spray of streaking particles, all in Catppuccin Mocha lavender.

It runs as its own small [Quickshell](https://quickshell.org) config. DMS itself isn't modified, so DMS updates can't break it.

> [!NOTE]
> The preview above is an SVG re-creation of `shaders/viz.frag` driven by a synthetic 120 bpm loop. For the real shader, try the **[live WebGL demo](https://dotmortis.github.io/dms-bar-visualizer/)**: it runs on a demo beat, a synth loop, your microphone or an audio file, with every tweakable on a slider.

## How it works

<p align="center"><img src="assets/layers.svg" alt="Layer diagram: the transparent DankBar on the top layer, the visualizer on the bottom layer, the wallpaper below" width="720"></p>

- **Layering:** a click-through Wayland layer surface on the `bottom` layer, sized and inset exactly like the DankBar. The DMS bar draws on the `top` layer, so with a transparent bar background the visualizer shows through.
- **Audio:** [cava](https://github.com/karlstav/cava) provides 32 frequency bands at 60 fps with light smoothing, so transients punch.
- **Follows the active player:** it tracks the MPRIS player DankBar shows (same selection rules) and captures the monitor of whichever output *that* player's stream plays to. Spotify on Bluetooth while the default output is HDMI just works. With no player, it falls back to the newest playing stream, then the default output.
- **Beat detection:** bass jumping above its recent average fires a kick. The kick's strength scales the shockwave and particles.
- **Matches DMS's maximize detection:** with a maximized window on a monitor's active workspace, the visualizer drops its gap and rounding together with the bar.

## Requirements

- Hyprland
- DankMaterialShell (top bar)
- PipeWire or PulseAudio

On Arch:

```sh
sudo pacman -S --needed quickshell cava libpulse qt6-shadertools
```

## Install

```sh
git clone https://github.com/dotMortis/dms-bar-visualizer ~/Projects/dms-bar-visualizer
cd ~/Projects/dms-bar-visualizer
./install.sh
```

The script:

1. compiles the shader
2. symlinks the repo to `~/.config/quickshell/bar-visualizer`
3. enables a systemd user service that starts with your graphical session

Use `./install.sh --no-service` to skip autostart and run it yourself with `qs -c bar-visualizer`.

Then make the bar background transparent: **DMS Settings → Dank Bar → Transparency = 0**.

### Uninstall

```sh
./install.sh --uninstall
```

## Configuration

All settings are at the top of `shell.qml` under `Tweakables`. Quickshell reloads on save.

| Property | Default | What it does |
| --- | --- | --- |
| `barThickness` | `40` | DankBar body height. It depends on DMS inner padding and font/icon scale. |
| `spacing` | `4` | DMS bar *spacing* (the gap around the bar) |
| `radius` | `12` | DMS corner radius |
| `followMaximize` | `true` | Mirror DMS's *maximize detection* |
| `intensity` | `1.0` | Overall brightness |
| `speed` | `1.0` | Animation speed |
| `kickThreshold` | `0.10` | Lower = more kicks detected |
| `kickDecay` | `6.0` | Higher = shorter impact |
| `bassStretch` | `1.4` | Above 1 spreads the bass (centre) wider, so it isn't hidden under centre widgets |

To find the right geometry, run `hyprctl layers`. The `dms:bar` surface height equals `barThickness + spacing`.

### Shader

The look lives in `shaders/viz.frag`: palette, ribbons, shockwave and particles. After editing it, recompile with `./install.sh --no-service` or:

```sh
/usr/lib/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 -o shaders/viz.frag.qsb shaders/viz.frag
```

To change colours, edit the `palette()` cycle and the `LAVENDER` / `MAUVE` / `PINK` / `BLUE` constants.

### README animations and demo

The SVGs in `assets/` are generated. After tweaking `assets/generate.py`, run `python3 assets/generate.py`.

`docs/index.html` is the live demo (served by GitHub Pages). It carries a GLSL ES port of `shaders/viz.frag`, so mirror shader changes there.

## Limitations

- **Top bar only:** bottom and side bars aren't supported yet.
- **One geometry for all screens:** a single bar geometry applies to every screen, and the visualizer shows on every monitor even if DankBar is disabled on some.
- **Player switching:** DMS doesn't expose which player it displays, so the visualizer re-implements the same rules. If you switch players by hand in the DMS media popout, the visualizer won't follow.

## Troubleshooting

- **Nothing moves:** check `pgrep -a cava` and `cat $XDG_RUNTIME_DIR/bar-visualizer-cava.conf`. The `source=` line should be the `.monitor` of the output you hear audio from.
- **Logs:**
  - with the service: `journalctl --user -u bar-visualizer -f`
  - started by hand: run `qs -c bar-visualizer` in a terminal and watch its output

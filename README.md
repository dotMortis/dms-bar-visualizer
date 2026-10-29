# dms-bar-visualizer

A shader-based audio visualizer that lives **behind the top bar of [DankMaterialShell](https://github.com/AvengeMedia/DankMaterialShell)** on Hyprland.

Neon ribbons shaped by the spectrum, waves pushed outward by the music's energy, and on every kick a chromatic shockwave plus a spray of streaking particles, all in Catppuccin Mocha lavender.

It runs as its own small [Quickshell](https://quickshell.org) config. DMS itself isn't modified, so DMS updates can't break it.

## How it works

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
| `bassStretch` | `1.8` | Above 1 spreads the bass (centre) wider, so it isn't hidden under centre widgets |

To find the right geometry, run `hyprctl layers`. The `dms:bar` surface height equals `barThickness + spacing`.

### Shader

The look lives in `shaders/viz.frag`: palette, ribbons, shockwave and particles. After editing it, recompile with `./install.sh --no-service` or:

```sh
/usr/lib/qt6/bin/qsb --glsl "100 es,120,150" --hlsl 50 --msl 12 -o shaders/viz.frag.qsb shaders/viz.frag
```

To change colours, edit the `palette()` cycle and the `LAVENDER` / `MAUVE` / `PINK` / `BLUE` constants.

## Limitations

- **Top bar only:** bottom and side bars aren't supported yet.
- **One geometry for all screens:** a single bar geometry applies to every screen, and the visualizer shows on every monitor even if DankBar is disabled on some.
- **Player switching:** DMS doesn't expose which player it displays, so the visualizer re-implements the same rules. If you switch players by hand in the DMS media popout, the visualizer won't follow.

## Troubleshooting

- **Nothing moves:** check `pgrep -a cava` and `cat $XDG_RUNTIME_DIR/bar-visualizer-cava.conf`. The `source=` line should be the `.monitor` of the output you hear audio from.
- **Logs:**
  - with the service: `journalctl --user -u bar-visualizer -f`
  - started by hand: run `qs -c bar-visualizer` in a terminal and watch its output

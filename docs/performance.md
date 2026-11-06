# Performance

What the Bar Visualizer and the Lock Ring cost, measured the same way at every step of the 1.0.0 performance work (#38), so that every claim of a speed-up can be checked. The first row of every table is v0.10.0, measured before any change. Each later step adds its row, measured the same way.

## Method

The replay harness, `harness/run`, runs a visualizer as it ships, in its own `qs`, on a fixed recorded input, and measures it. [CONTRIBUTING.md](../CONTRIBUTING.md#measuring) has the details; in short:

- **Input.** Only cava's output and DMS's lyrics are swapped. In place of cava, `harness/bin/cava` replays a recorded band stream from `tests/fixtures`: the reference track, `steady_house` (24.05 s a loop, 44 Kicks). In place of DMS's lyrics, a stand-in serves the fixed timed lyrics in `harness/lyrics.json`. A stand-in MPRIS player on the run's own session bus is the Active Player, and a stand-in `pactl` answers the sink probe with that player's stream. Everything downstream (the audio pipeline, the Kick detector, the layers, Lyric Words, the shaders) is the real code.
- **Hosts.** `bar` is the Bar Visualizer (`shell.qml`) in its own `qs`. `lock` is the Lock Ring in a test `qs` (`harness/lockhost`) that loads the plugin the way DMS does, from its `file://` URL. Neither run touches the live DMS, its lock screen, the live visualizers or the user's `config.json`: every run gets its own runtime dir, config dir (every setting at its default), cache and session bus.
- **Window.** 5 s of warm-up, then one whole loop of the track (24.05 s).
- **CPU** is % of one core, as htop shows it, for `qs`, its capture and every process they start (`sh`, `pactl`), from the cgroup of the systemd scope `qs` runs in. Measured with `--cpu-only`, since the other measures cost about half a point themselves.
- **Every other measure** comes from a separate run without `--cpu-only`: frames per second and late frames (more than 1.5 refreshes after the frame before) from Qt's render-loop log, the GPU's time per frame from Qt's timestamp queries, GPU busy (% of the render engine) from the DRM driver's fdinfo, and a `perf` profile of where the CPU time goes. That run's CPU is in the tables too, as "CPU with every measure on", but compare it only with runs of the same kind.
- **Repeats.** Every cell is the median of several runs, made back to back on an idle desktop with the user's own `bar-visualizer.service` stopped, the scenarios and hosts taken in turn so drift spreads over all of them. A cell reads `median (lowest-highest, runs)`. `music_lyrics` varies most from run to run, so it gets more runs.
- **Unlocked.** The screen must stay unlocked, and the display on, for every run: while the session is locked the compositor draws none of the harness's windows, so Qt renders no frames and the visualizer's cost isn't what it is on the desktop (`loginctl show-session <session> -p LockedHint` must say `no`; a run with every measure whose `frames` is 0 drew nothing and is left out). Turn off auto-lock and the display's idle sleep while measuring.
- **Load.** Each run records the load average when it starts (`loadavg` in `result.json`). A run that started under a load spike (a 1-minute load average over 2 on this 32-thread machine, idle at about 1) is left out and run again.

CPU depends on the machine and on what else runs, so these numbers compare steps with each other on this machine, not with other machines. The machine: AMD Ryzen 9 9950X (16 cores, 32 threads), Intel Arc B580 (xe, Mesa 26.2.6, Qt RHI OpenGL), one 3440x1440 display at 60 Hz, Hyprland, Linux 7.2, Qt 6.12.0, Quickshell 0.3.2.

## Scenarios

| Scenario | Band stream | Active Player | DMS's lyrics |
| --- | --- | --- | --- |
| `music` | the reference track | playing it ("Steady House") | no DMS |
| `music_lyrics` | the reference track | playing it ("Steady House") | the timed lyrics |
| `silence_no_player` | cava's silence | none | no DMS |
| `silence_paused` | cava's silence | paused | no DMS |
| `silence_playing` | cava's silence | playing a silent track ("Silence") | none found |

Cava's silence is what cava prints when nothing plays: 5 s of all-zero frames, then nothing. Lyric Words' cost is the difference between `music_lyrics` and `music`. Every scenario runs on both hosts.

## Re-running

For one cell, from the repo root (`--commit` measures another commit without changing the checkout):

```sh
RUNS=~/bvh-runs   # anywhere outside the repo
harness/run --commit v0.10.0 --cpu-only --host lock --out $RUNS/v0.10.0/cpu/lock-music-1 music   # CPU
harness/run --commit v0.10.0 --host lock --out $RUNS/v0.10.0/full/lock-music-1 music              # every measure
```

A step's row is every scenario on both hosts: at least 3 `--cpu-only` runs a cell (6 or more for `music_lyrics`) and at least 1 run with every measure (3 for `music_lyrics`), taken in turn. That is about 30 minutes. Then:

```sh
node harness/table.mjs --runs $RUNS                 # every run with its load average, CPU and kind
node harness/table.mjs --max-load 2 $RUNS           # the tables below, runs under a load spike left out
```

`harness/table.mjs` reads every `result.json` under the dirs it's given, takes a row per commit, and prints the tables in the form below. Paste the new step's row into each table and name the step.

## Results

Not measured yet: the v0.10.0 row comes first.

## Accepted costs

What is left once the work is done, what it costs and why it stays. Empty for now.

| What is left | What it costs | Why it stays |
| --- | --- | --- |

## The live check at each milestone

The harness replays a recorded input in a test host, so it could drift from what the visualizers do on the desktop. At each milestone (the end of each spec, and before 1.0.0), check by hand that it hasn't:

1. Install the milestone's build as a user would (`bar-visualizer.service`, and the Lock Ring into DMS).
2. **Bar Visualizer, real music.** Play a real track with a strong kick in a real player. The bar moves with the music, Kicks land on the beat, and htop's CPU for its `qs` is in line with the `music` row.
3. **Bar Visualizer, real lyrics.** Play a track DMS has synced lyrics for. Lyric Words show and follow the song, and the CPU is in line with the `music_lyrics` row.
4. **Bar Visualizer, Silence.** Pause the player, then close it. The bar goes quiet, and the CPU is in line with the `silence_paused` and `silence_no_player` rows.
5. **Lock Ring, in the live DMS lock screen.** Lock the screen with the same music and lyrics playing. The ring moves with the music and shows Lyric Words, and DMS's CPU in htop rises by about the `lock` rows' cost, no more. Unlock, and check DMS still runs normally.
6. Write the result below: the date, the commit, what was checked and anything that didn't match. A mismatch is a harness bug to fix before the next row is trusted.

| Date | Commit | Checked | Result |
| --- | --- | --- | --- |

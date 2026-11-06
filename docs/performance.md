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
- **Unlocked.** The screen must stay unlocked, and the display on, for every run: while the session is locked the compositor draws none of the harness's windows, so Qt renders no frames and the visualizer's cost isn't what it is on the desktop (`harness/run` refuses to start while logind says the session is locked, and fails a run locked by the end of its window or a run with music that rendered no frame). Turn off auto-lock and the display's idle sleep while measuring.
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

v0.10.0 was measured on 2026-11-06, 16:04 to 16:38, with `--commit v0.10.0` from `perf/native-core` (the harness of 9eab625): 4 `--cpu-only` runs a cell (7 for `music_lyrics`) and 1 run with every measure (3 for `music_lyrics`). The 1-minute load average at the start of the runs kept was 0.67 to 1.96; six runs that started at 2.25 to 2.77 were left out and run again. Cells read `median (lowest-highest, runs)`; a single number is a single run.

**CPU, --cpu-only: % of one core (qs + capture + children)**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 1.6 (1.5-1.7, 4) | 14.6 (14.4-15.7, 7) | 1.1 (1.1-1.2, 4) | 1.2 (1.2-1.3, 4) | 1.2 (1.2-1.2, 4) | 2.3 (2.3-2.4, 4) | 32.8 (29.4-37.4, 7) | 1.6 (1.5-1.6, 4) | 1.6 (1.6-1.6, 4) | 1.6 (1.6-1.7, 4) |

**CPU with every measure on: % of one core**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 2.5 | 18.5 (18.4-19.9, 3) | 2.0 | 1.8 | 1.9 | 3.1 | 34.8 (27.8-38.4, 3) | 2.4 | 2.4 | 2.4 |

**Frames per second, per window**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 60.0 | 60.0 (60.0-60.0, 3) | 60.0 | 60.0 | 60.0 | 60.0 | 59.9 (59.3-60.0, 3) | 60.0 | 60.0 | 60.0 |

**Late frames, per window of one loop**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 0 | 0 (0-0, 3) | 0 | 0 | 0 | 0 | 3 (0-9, 3) | 0 | 0 | 0 |

**GPU frame time, mean: ms**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 0.906 | 2.168 (2.026-2.168, 3) | 0.095 | 0.095 | 0.095 | 3.458 | 3.756 (3.721-3.771, 3) | 2.640 | 2.638 | 2.640 |

**GPU frame time, 95th percentile: ms**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 1.200 | 3.097 (2.930-3.104, 3) | 0.097 | 0.096 | 0.097 | 3.918 | 4.570 (4.490-4.592, 3) | 2.658 | 2.657 | 2.659 |

**GPU busy: % of the render engine**

| Step | Commit | bar music | bar music_lyrics | bar silence_no_player | bar silence_paused | bar silence_playing | lock music | lock music_lyrics | lock silence_no_player | lock silence_paused | lock silence_playing |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| v0.10.0 | 255ff1f | 5.61 | 12.51 (11.77-12.62, 3) | 0.75 | 0.75 | 0.75 | 20.79 | 22.32 (22.31-22.65, 3) | 15.93 | 15.92 | 15.93 |

## Where the cost goes: v0.10.0

From the profiles of the v0.10.0 runs with every measure above (1 run a cell, 3 for `music_lyrics`), with `node harness/profile.mjs --breakdown` ([CONTRIBUTING.md](../CONTRIBUTING.md#measuring)). Each part is % of one core: its share of the profile times the run's user CPU. "kernel" is the run's system time, which the profile can't see. These are runs with every measure on, so each row is about half a point above its `--cpu-only` cell, most of it in "kernel". The capture here is the harness's stand-in, not cava: see the capture below for real cava.

| Host | Scenario | Runs | CPU | JS engine | Qt Quick, gui thread | Quickshell | gui thread, the rest | GPU driver, render thread | scene graph, render thread | GPU driver, its own threads | qs, other threads | capture | pactl | sh and other children | kernel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bar | music | 1 | 2.5 | 0.52 | 0.03 | 0.03 | 0.28 | 0.20 | 0.30 | 0.00 | 0.19 | 0.03 | 0.02 | 0.00 | 0.90 |
| bar | music_lyrics | 3 | 18.5 | 5.76 | 0.24 | 0.06 | 2.05 | 1.32 | 2.70 | 3.08 | 1.19 | 0.01 | 0.04 | 0.01 | 2.10 |
| bar | silence_no_player | 1 | 2.0 | 0.19 | 0.02 | 0.02 | 0.20 | 0.23 | 0.31 | 0.00 | 0.19 | 0.00 | 0.04 | 0.01 | 0.70 |
| bar | silence_paused | 1 | 1.8 | 0.25 | 0.02 | 0.01 | 0.16 | 0.17 | 0.37 | 0.00 | 0.23 | 0.00 | 0.09 | 0.01 | 0.60 |
| bar | silence_playing | 1 | 1.9 | 0.21 | 0.02 | 0.05 | 0.21 | 0.18 | 0.36 | 0.00 | 0.14 | 0.00 | 0.11 | 0.02 | 0.60 |
| lock | music | 1 | 3.1 | 1.09 | 0.03 | 0.02 | 0.41 | 0.28 | 0.38 | 0.00 | 0.17 | 0.03 | 0.07 | 0.01 | 0.60 |
| lock | music_lyrics | 3 | 34.8 | 23.68 | 0.33 | 0.03 | 3.75 | 0.98 | 1.62 | 1.52 | 0.61 | 0.02 | 0.05 | 0.01 | 2.10 |
| lock | silence_no_player | 1 | 2.4 | 0.56 | 0.03 | 0.03 | 0.35 | 0.24 | 0.35 | 0.00 | 0.18 | 0.00 | 0.05 | 0.01 | 0.60 |
| lock | silence_paused | 1 | 2.4 | 0.69 | 0.01 | 0.03 | 0.27 | 0.27 | 0.38 | 0.00 | 0.16 | 0.00 | 0.07 | 0.01 | 0.50 |
| lock | silence_playing | 1 | 2.4 | 0.67 | 0.01 | 0.02 | 0.27 | 0.26 | 0.27 | 0.00 | 0.17 | 0.00 | 0.12 | 0.01 | 0.60 |

What it says, part by part:

- **QML's JS engine** is the largest part wherever something moves. With call stacks: on the bar with music, 41 % of the gui thread's time is under the handler of cava's lines (each line sets the bands, which runs the Kick detector and every binding the shader reads) and 25 % under the FrameAnimation's per-frame handler; on the Lock Ring with Lyric Words, 78 % of it is under one per-frame `onTriggered`. "gui thread, the rest" (Qt Core's event loop, malloc, libc) grows with it: 2.1 points on the bar and 3.8 on the Lock Ring with Lyric Words, mostly called from the JS. With Lyric Words, the JS and its calls are about 7 of the bar's 16 extra points and 26 of the Lock Ring's 32.
- **The scene graph and the GPU driver** (the render thread, plus Mesa's own driver thread in `qs`, `qs:gdrv0`) cost 0.5 to 0.7 of a core in every scenario without Lyric Words, Silence included: v0.10.0 redraws every frame even in Silence. With Lyric Words they rise to 7.1 on the bar and 4.1 on the Lock Ring.
- **Lyric Words' blur layers.** Each word is drawn through MultiEffects, each an offscreen layer with its blur passes. On the bar's render thread with Lyric Words, 39 % of the time is inside drawing those layers (`QSGRhiLayer`, `QQuickShaderEffectSource` in the call stack; 0 % without Lyric Words); on the Lock Ring, 34 %. Mesa's driver thread only works with Lyric Words (0 without them, 3.1 points on the bar, 1.5 on the Lock Ring); it runs the GL calls the render thread queues, so which pass it serves isn't in its stacks, but nothing else is new in those frames. Together: the render side is 6.6 of the bar's 16 extra points with Lyric Words (scene graph +2.4, GPU driver +4.2) and 3.5 of the Lock Ring's 32. On the GPU, Lyric Words take the bar's frame time from 0.91 to 2.17 ms and its GPU busy from 5.6 to 12.5 %; the Lock Ring's from 3.46 to 3.76 ms and 20.8 to 22.3 %.
- **Quickshell's own code** (the `quickshell` binary) is 0.01 to 0.06 of a core everywhere.
- **The capture, its pipe and the band parsing.** In the harness the capture is the stand-in, 0.03 of a core: real cava costs more (below). Measured on its own, qs reading cava's 60 lines a second and parsing them costs about 0.2 of a core (below).
- **`pactl`.** The sink probe every 2 s (`sh`, then two `pactl`) is 0.3 of a core in every scenario (`cpu_other_pct` from the scope's cgroup, kernel time included; its user space alone is 0.02 to 0.12 in the profile). In Silence that's about a quarter of the bar's 1.1 to 1.2.
- **The kernel**: 0.5 to 0.9 of a core with every measure on (about half of it the measures' own), 2.1 with Lyric Words; with `--cpu-only`, 0.2 to 0.3 on the floor below.

### Quickshell's floor and the real capture

Measured on 2026-11-06, 16:47 to 16:55, on the same machine (1-minute load average 0.2 to 1.2), to see what's left once the hot path is native. Neither can be read off the v0.10.0 profiles.

**Quickshell's floor.** A throwaway variant of `shell.qml` (never merged, measured with `harness/run --commit` on the `music` scenario, so with the same window, stand-ins and settings): the same window and the same `viz.frag`, redrawn at 60 fps, with no script per frame: its time and wave phase run on two `NumberAnimation`s (native), the bands are constants, and there's no Kick detector, no Lyric Words and no sink probe. The stand-in capture runs in all three; they differ only in what qs does with its lines:

| Variant | CPU, `--cpu-only` (3 runs) | CPU with every measure on (1 run) |
| --- | --- | --- |
| floor: qs doesn't read the capture | 0.8 (0.8-0.9) | 1.5: JS 0.03, scene graph 0.33, GPU driver 0.21, gui thread's rest 0.17, other threads 0.19, kernel 0.50 |
| pipe: qs reads every line, does nothing with it | 0.9 (0.9-1.0) | - |
| parse: qs reads every line and parses it as v0.10.0 did | 1.0 (0.9-1.1) | 1.7: JS 0.10, scene graph 0.30, GPU driver 0.15, gui thread's rest 0.24, other threads 0.24, kernel 0.60 |
| v0.10.0, `bar music` (above) | 1.6 (1.5-1.7) | 2.5 |

The floor's GPU frame time (0.095 ms) is lower than `bar music`'s (0.91 ms): the shader's cost depends on the bands and Kicks it gets, so the floor isn't a GPU floor.

**Real cava.** cava 1.0.0 with v0.10.0's settings (32 bands, 60 fps, `autosens`, `noise_reduction=8`), its own process's CPU over the same 24.05 s window after 5 s, its lines read and dropped:

| Input | cava's CPU: % of one core |
| --- | --- |
| the reference track (the `steady_house` synth from `tests/fixtures/record.py`) through a fifo, in real time | 0.67 (0.67-0.71, 3 runs; user 0.54-0.62, system 0.04-0.12) |
| pulse, v0.10.0's exact config, on an idle sink's monitor (Silence: cava asleep after `sleep_timer`, 0.6 lines a second) | 0.33 (1 run) |

Not measured: real cava on pulse with music playing (that needs a sink nobody hears). It's at least the fifo's 0.67, since the FFT and the output are the same and only the reading differs.

## The two profile decisions: provisional

The two open choices from #38, answered from v0.10.0 and the measurements above. Both depend on the cost once the hot path is native, which v0.10.0 can only show indirectly, so both are **provisional: spec D (#42) measures the Bar Visualizer on the core and makes the final call**, with real cava counted in.

**Bar host: keep Quickshell.** Quickshell's engine and scene graph aren't where v0.10.0's cost is: the JS is (5.8 of the bar's 18.5 with Lyric Words, plus 2.1 of malloc and Qt Core under it), and so are the blur layers, which a standalone renderer would draw just the same. Quickshell's own code is under 0.1 of a core. What would be left once nothing per frame is script is measured above: 0.8 of a core redrawing the bar at 60 fps with no script, against 1.6 for v0.10.0 with music, and in its run with every measure, 0.54 of its 1.5 is the render thread and the GPU driver, which a standalone client needs too (inferred: it would need a GL or Vulkan surface and a frame loop of its own). What going standalone could save is the rest of Qt's gui thread and event loop, a few tenths of a point. And in Silence the floor goes away entirely once nothing redraws (spec B). Not significant, so Quickshell stays.

**Capture: keep cava.** At v0.10.0 the capture isn't a large cost: real cava is 0.67 of a core with music (0.33 in Silence), and qs's pipe and parsing about 0.2, against 14.6 for the bar with Lyric Words and 32.8 for the Lock Ring. But it is a large share of what's left once the hot path is native: with the floor (0.8) and the parsing (0.2), cava's 0.67 makes the capture about 0.9 of an estimated 1.7 for the bar with music, before the native core's own work and with the sink probe gone (inferred, not measured: no native core exists yet). Our own capture would still read PipeWire and run an FFT 60 times a second, so it would save part of that, not all of it. In Silence cava's 0.33 can go without replacing it, by not running cava while there's no Active Player (spec B's work). Provisionally cava stays; spec D re-measures with real cava, and if the capture is then the largest part left, own capture becomes spec F.

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

# The council round

How the 1.0.0 performance work (#38) is judged: three reviewers score where `perf/native-core` stands against v0.10.0. Every round runs the same way, as written here, so that rounds can be compared.

## The council

Three fresh agents a round:

- a **performance engineer**,
- a **graphics/visual reviewer**,
- a **code reviewer**.

Fresh means a new session for each, started from nothing but the brief and the evidence below: no memory of earlier rounds, no earlier round's scores, no other reviewer's scores. Start all three at once and keep them apart; none sees another's reply until all three have answered. Turn off their network and GitHub tools (no `gh`, no web fetch), so that they judge only the evidence.

## The evidence

All three get the same evidence, in one directory made once a round, outside the repo:

| Where | What |
| --- | --- |
| `BRIEF.md` | the brief below, word for word |
| `tree/` | the code: the commit under review, exported with `git archive` (no git history) |
| `results/` | the harness's results for every scenario on both hosts (`harness/run`'s output dirs: `result.json`, `qs.log`, `profile.txt`, `perf.data`), the commit's runs and v0.10.0's, and `tables.md`, the tables `harness/table.mjs` makes of them |
| `recordings/` | screen recordings of v0.10.0 and the commit on the same replayed input, both visualizers, music and music with Lyric Words (`harness/record`) |

The v0.10.0 baseline is in both `results/` (its runs) and `tree/docs/performance.md` (its row). Nothing else goes in: no issues, PRs, chat, notes or earlier rounds.

To make it, from the repo root on the commit under review (`COMMIT`), with the screen unlocked, the desktop idle and `bar-visualizer.service` stopped:

```sh
COMMIT=$(git rev-parse HEAD)
E=~/council/$(date +%F)-${COMMIT:0:7}      # outside the repo
mkdir -p "$E/tree" "$E/results"
git archive "$COMMIT" | tar -x -C "$E/tree"
sed -n '/^<!-- brief: begin -->$/,/^<!-- brief: end -->$/{//!p}' docs/council.md > "$E/BRIEF.md"
```

Then the results: a step's row for the commit and one for v0.10.0, made back to back with `harness/row` ([performance.md](performance.md#re-running)), then the tables and the recordings:

```sh
harness/row --commit "$COMMIT" --out "$E/results/$COMMIT"
harness/row --commit v0.10.0 --out "$E/results/v0.10.0"
node harness/table.mjs --max-load 2 "$E/results" > "$E/results/tables.md"
harness/record --out "$E/recordings" v0.10.0 "$COMMIT"
```

Check the recordings show the visualizers and nothing else before handing them over.

## The brief

Each reviewer gets this, word for word, with one line before it naming their role ("You are the performance engineer.", "You are the graphics/visual reviewer.", "You are the code reviewer.").

<!-- brief: begin -->
# Council review: the Bar Visualizer and the Lock Ring against v0.10.0

You are one of three reviewers, each working alone: a performance engineer, a graphics/visual reviewer and a code reviewer. Your role is named in the line above this brief. Score every category below, not only your role's; your role is where you look hardest.

## What is under review

Two music visualizers for DankMaterialShell (DMS): the **Bar Visualizer**, behind the DMS top bar, and the **Lock Ring**, a plugin on the DMS lock screen. `tree/GLOSSARY.md` says what their parts are called. Up to v0.10.0 they cost too much CPU: every audio and video frame ran through script. The work under review makes both use as little CPU and GPU as they can, with the same features and the same look by eye as v0.10.0, and the user's `config.json` unchanged. `tree/docs/adr/` has the decisions behind it (0007 and 0008 most of all). You judge the state in `tree/` against v0.10.0.

## The evidence

This directory holds everything you get. Work from it alone: no network, no GitHub, no git history, nothing outside this directory.

- `tree/`: the code under review.
- `results/`: the replay harness's runs, v0.10.0's and the code under review's, every scenario on both hosts, and `results/tables.md`, the tables made from them. `tree/docs/performance.md` says how they were measured, what each measure means and what the scenarios are; `tree/CONTRIBUTING.md` (Measuring) has the details. `tree/docs/performance.md` also holds the v0.10.0 baseline.
- `recordings/`: screen recordings of v0.10.0 and the code under review on the same replayed input, both visualizers, music and music with Lyric Words. `recordings/README.txt` says which file is which. `ffmpeg` and `ffprobe` are there to look at them (for example `ffmpeg -i <file> -vf fps=4 <dir>/%03d.png` for stills to compare).

You may read anything here and run the unit tests (`node --test` in `tree/`). Don't run `harness/run` or `harness/record`, and don't install anything or touch the running desktop.

## The categories

Score each from 0 to 10, with a short reason: one to three sentences naming what in the evidence the score rests on. 10 means you find nothing left to gain in it; 0 means it is worse than v0.10.0, or broken.

1. **CPU in Silence**: all three cases (no Active Player, paused, playing but silent), on both visualizers.
2. **CPU with music**: both visualizers, on the reference track.
3. **CPU with music and Lyric Words**: the same with Lyric Words on.
4. **GPU cost**: passes, render targets, frame time.
5. **Smoothness**: steady frame timing, Kicks in sync with the music.
6. **Faithful look**: the same features and the same look by eye as v0.10.0.
7. **Lock screen safety**: whether the native code can take DMS down.
8. **Code quality**: clarity, tests, one source of truth across native and WASM.

## Your reply

Your role, then this table, filled in, then anything else you found that the table has no room for:

| # | Category | Score | Reason |
| --- | --- | --- | --- |
| 1 | CPU in Silence | | |
| 2 | CPU with music | | |
| 3 | CPU with music and Lyric Words | | |
| 4 | GPU cost | | |
| 5 | Smoothness | | |
| 6 | Faithful look | | |
| 7 | Lock screen safety | | |
| 8 | Code quality | | |
<!-- brief: end -->

## Keeping a round

A round's scores and reasons are kept in one comment on #38, "Council round N: `<commit>`": the date, the commit, where the evidence was (its directory, and `results/tables.md` pasted in), and the three replies word for word, each under its role. Not in the repo: the next round's reviewers get the repo, and they mustn't see earlier scores. Keep the evidence directory until the next round.

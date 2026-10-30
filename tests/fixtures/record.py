#!/usr/bin/env python3
"""Record the kick replay fixtures: synthesized tracks with known kick onsets, played through real cava.

Each scenario synthesizes a short track whose kick onsets are known to the sample, streams it through
cava with the visualizer's own cava settings (shell.qml) in real time, and saves every line cava prints
with the time it arrived. tests/kick-replay.test.mjs replays these lines through docs/kick.mjs. The test
run only reads the committed fixtures; recording is a manual step.

Re-record (needs cava, python3 and numpy; runs in real time, about 25 s per scenario):

    python3 tests/fixtures/record.py              # list the scenarios
    python3 tests/fixtures/record.py all          # re-record all of them (about 4 minutes)
    python3 tests/fixtures/record.py zoo2 dnb_808 # re-record some

Keep the machine otherwise idle while it records: the timestamps are wall-clock arrival times. A
re-recorded fixture comes out slightly different every time, so re-measure the budgets in
tests/kick-replay.test.mjs afterwards and say in the PR why they moved.

Add a scenario: write a function that builds a Track and decorate it with @scenario("name", "what it
tests"). Add every kick with track.kick(), which records its onset, and every other sound with
track.add(). Keep the track as short as the failure it targets allows. Record it, then give it budgets
in tests/kick-replay.test.mjs. A scenario that checks something other than kicks can leave the
onsets empty and put what its test needs into track.info, which lands in the fixture's header.

Fixture format (<scenario>.txt): the first line is a JSON header,
    {"scenario": ..., "about": ..., "cava": "<cava -v>", "onsets": [seconds, ...], ...track.info}
and every further line is one cava frame, "<arrival seconds> <cava's raw ascii line>", e.g.
    2.1043 412;655;803;390;...;0;
Times count from the first audio sample written to cava.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parent
SR = 44100

# shell.qml's cava config, with the input swapped from pulse to a fifo. Keep the two in sync, and the
# layout (bars, cutoffs, sample rate) with docs/kick.mjs.
CAVA_CONF = """[general]
framerate=60
bars=32
autosens=1
sleep_timer=5
lower_cutoff_freq=30
higher_cutoff_freq=14000

[input]
method=fifo
source={fifo}
sample_rate=44100
sample_bits=16

[output]
method=raw
raw_target=/dev/stdout
data_format=ascii
ascii_max_range=1000
channels=mono
mono_option=average

[smoothing]
noise_reduction=8
"""

SCENARIOS = {}


def scenario(name, about):
    def register(build):
        SCENARIOS[name] = (about, build)
        return build
    return register


class Track:
    """A mono buffer of `seconds`, plus the onset of every kick placed in it."""

    def __init__(self, seconds, seed=1):
        self.buf = np.zeros(int(seconds * SR))
        self.onsets = []
        self.info = {}
        self.rng = np.random.default_rng(seed)

    def add(self, sound, at):
        i = int(at * SR)
        j = min(len(self.buf), i + len(sound))
        self.buf[i:j] += sound[: j - i]

    def kick(self, at, **drum):
        self.add(kick_drum(self.rng, **drum), at)
        self.onsets.append(int(at * SR) / SR)


# --- Sounds ---

def fade_out(sound, seconds=0.01):
    n = min(len(sound), int(seconds * SR))
    sound[len(sound) - n:] *= np.linspace(1, 0, n)
    return sound


def kick_drum(rng, f0=150.0, f1=48.0, sweep=0.045, decay=0.32, length=0.45, gain=0.9):
    """A sine whose pitch falls from f0 to f1 as it rings, plus a short noise click."""
    t = np.arange(int(length * SR)) / SR
    freq = f1 + (f0 - f1) * np.exp(-t / sweep)
    phase = 2 * np.pi * np.cumsum(freq) / SR
    env = np.exp(-t / decay) * np.minimum(1, t / 0.002)
    click = np.exp(-t / 0.004) * rng.standard_normal(len(t)) * 0.15
    return fade_out(gain * (np.sin(phase) * env + click))


def bass_note(freq, length, gain=0.45):
    t = np.arange(int(length * SR)) / SR
    env = np.minimum(1, t / 0.01) * np.minimum(1, (length - t) / 0.02)
    saw = 2 * ((t * freq) % 1) - 1
    # crude low-pass: blend with a sine so it sits in the bass bands
    return gain * env * (0.6 * np.sin(2 * np.pi * freq * t) + 0.4 * saw)


def hat(rng, length=0.06, gain=0.12):
    t = np.arange(int(length * SR)) / SR
    noise = np.diff(rng.standard_normal(len(t)), prepend=0)  # high-passed noise
    return gain * noise * np.exp(-t / 0.015)


# --- Scenarios ---
# 24 s each, kicks from 2 s (cava starts up in the silence before) to 1 s before the end.

def beats(bpm, seconds):
    t = 2.0
    while t < seconds - 1:
        yield t
        t += 60 / bpm


@scenario("kick_only", "kicks alone, four on the floor at 124 bpm")
def kick_only():
    track = Track(24)
    for t in beats(124, 24):
        track.kick(t)
    return track


@scenario("steady_house", "steady house at 124 bpm: kick, offbeat bassline and hats that never change")
def steady_house():
    track = Track(24)
    beat = 60 / 124
    notes = [55.0, 55.0, 65.4, 49.0]
    for n, t in enumerate(beats(124, 24)):
        track.kick(t)
        track.add(bass_note(notes[n % 4], beat * 0.45), t + beat / 2)
        track.add(hat(track.rng), t + beat / 2)
        track.add(hat(track.rng, gain=0.06), t + beat / 4)
        track.add(hat(track.rng, gain=0.06), t + 3 * beat / 4)
    return track


@scenario("sustained_bass", "kicks at 140 bpm over a sustained 41 Hz sub-bass drone")
def sustained_bass():
    track = Track(24)
    t = np.arange(len(track.buf)) / SR
    track.buf += 0.35 * np.sin(2 * np.pi * 41.2 * t) * (t > 1.5)
    for t in beats(140, 24):
        track.kick(t)
    return track


@scenario("loud_quiet", "kicks and hats at 124 bpm that drop by 12 dB at 12 s")
def loud_quiet():
    track = Track(24)
    beat = 60 / 124
    for t in beats(124, 24):
        gain = 0.9 if t < 12 else 0.9 * 10 ** (-12 / 20)
        track.kick(t, gain=gain)
        track.add(hat(track.rng, gain=0.12 * gain / 0.9), t + beat / 2)
    return track


@scenario("dnb_808", "long ringing 808 kicks at 174 bpm, on 1 and the and of 3, with a snare-ish noise on 2 and 4")
def dnb_808():
    track = Track(24)
    beat = 60 / 174
    t = 2.0
    while t < 23:
        for off in (0, 2.5):
            track.kick(t + off * beat, f0=120, f1=45, sweep=0.06, decay=0.7, length=1.0, gain=0.9)
        for b in (1, 3):
            track.add(hat(track.rng, gain=0.3, length=0.15), t + b * beat)
        t += 4 * beat
    return track


@scenario("double_kick", "quarter kicks at 124 bpm with a softer 16th-note kick before every 4th beat")
def double_kick():
    track = Track(24)
    beat = 60 / 124
    for n, t in enumerate(beats(124, 24)):
        track.kick(t)
        if n % 4 == 3:
            track.kick(t + beat * 0.75, gain=0.7)
    return track


def zoo(seed):
    track = Track(24)
    r = np.random.default_rng(seed)
    beat = 60 / 124
    for t in beats(124, 24):
        track.kick(t, f0=r.uniform(90, 260), f1=r.uniform(38, 70), sweep=r.uniform(0.015, 0.09),
                   decay=r.uniform(0.08, 0.6), gain=r.uniform(0.5, 0.95))
        track.add(hat(track.rng), t + beat / 2)
        if r.random() < 0.5:
            note = r.choice([55.0, 65.4, 73.4, 49.0])
            track.add(bass_note(note, beat * 0.4, gain=r.uniform(0.2, 0.5)), t + beat / 2)
    return track


for _seed in (1, 2, 3):
    scenario(f"zoo{_seed}", "every kick a different pitch, sweep, decay and level, at 124 bpm with hats and some bass")(
        lambda seed=_seed: zoo(seed))


@scenario("tones", "a stepped sine sweep from 30 Hz to 960 Hz, 0.4 s per tone: which band cava puts each frequency in")
def tones():
    # Eighth-octave steps over the demo's kick range sliders, plus the four tones spec #1 measured.
    # No kicks: the header's "tones" lists each tone's frequency, start and length for the band test.
    freqs = sorted({round(30 * 2 ** (k / 8), 1) for k in range(41)} | {35.0, 40.0, 50.0, 90.0})
    length, step = 0.4, 0.45
    track = Track(1 + step * len(freqs) + 0.5)
    t = np.arange(int(length * SR)) / SR
    env = np.minimum(1, np.minimum(t, length - t) / 0.01)
    track.info["tones"] = []
    for n, hz in enumerate(freqs):
        at = 1 + n * step
        track.add(0.5 * np.sin(2 * np.pi * hz * t) * env, at)
        track.info["tones"].append({"hz": hz, "at": round(at, 4), "length": length})
    return track


# --- Recording ---

def record(name):
    about, build = SCENARIOS[name]
    track = build()
    peak = np.max(np.abs(track.buf))
    if peak > 0.98:
        track.buf *= 0.98 / peak
    # cava reads fifo data as interleaved stereo: mono samples would play at twice the frequency.
    pcm = (np.clip(track.buf, -1, 1) * 32767).astype("<i2")
    stereo = np.repeat(pcm[:, None], 2, axis=1).tobytes()
    version = subprocess.run(["cava", "-v"], capture_output=True, text=True).stdout.strip()

    tmp = tempfile.mkdtemp()
    fifo = os.path.join(tmp, "audio.fifo")
    os.mkfifo(fifo)
    conf = os.path.join(tmp, "cava.conf")
    with open(conf, "w") as f:
        f.write(CAVA_CONF.format(fifo=fifo))
    cava = subprocess.Popen(["cava", "-p", conf], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL)
    lines = []
    start = None

    def read():
        for raw in iter(cava.stdout.readline, b""):
            if start is not None and raw.endswith(b"\n"):  # not the half line cut off by kill()
                lines.append((time.monotonic() - start, raw.decode().rstrip("\n")))

    reader = threading.Thread(target=read, daemon=True)
    reader.start()
    with open(fifo, "wb", buffering=0) as audio:  # blocks until cava opens the fifo
        start = time.monotonic()
        chunk = 256  # samples per write, about 6 ms
        for i in range(0, len(pcm), chunk):
            delay = start + i / SR - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            audio.write(stereo[i * 4:(i + chunk) * 4])
        time.sleep(0.3)  # cava lags the audio; let the last kick's frames through
    cava.kill()
    cava.wait(2)
    reader.join(1)
    os.remove(fifo)
    os.remove(conf)
    os.rmdir(tmp)

    header = {"scenario": name, "about": about, "cava": version,
              "onsets": [round(t, 6) for t in track.onsets], **track.info}
    path = OUT / f"{name}.txt"
    with open(path, "w") as f:
        f.write(json.dumps(header) + "\n")
        for t, line in lines:
            f.write(f"{t:.4f} {line}\n")
    print(f"{name}: {len(lines)} frames over {lines[-1][0]:.1f} s, {len(track.onsets)} onsets -> {path}")


def main():
    names = sys.argv[1:]
    if not names:
        print("usage: record.py all | <scenario>...\n\nscenarios:")
        for name, (about, _) in SCENARIOS.items():
            print(f"  {name:15} {about}")
        return
    if names == ["all"]:
        names = list(SCENARIOS)
    unknown = [n for n in names if n not in SCENARIOS]
    if unknown:
        sys.exit(f"unknown scenario: {', '.join(unknown)}")
    for name in names:
        record(name)


if __name__ == "__main__":
    main()

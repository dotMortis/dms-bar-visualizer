#!/usr/bin/env python3
"""Generate the animated SVGs used in the README.

The hero banner is an SVG/SMIL re-creation of shaders/viz.frag driven by a synthetic
120 bpm loop, so it animates on GitHub without a video. Run: python3 assets/generate.py
"""
import math
import random
from pathlib import Path

OUT = Path(__file__).resolve().parent
TAU = math.tau

# Catppuccin Mocha, same constants and cycle as palette() in viz.frag.
LAVENDER = (0.706, 0.745, 0.996)
MAUVE = (0.796, 0.651, 0.969)
PINK = (0.961, 0.761, 0.906)
BLUE = (0.537, 0.706, 0.980)
CYCLE = [LAVENDER, MAUVE, LAVENDER, PINK, LAVENDER, BLUE, LAVENDER]


def smoothstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def palette(h):
    f = (h % 1.0) * 6.0
    i = int(f)
    m = smoothstep(0, 1, f - i)
    a, b = CYCLE[i], CYCLE[i + 1]
    return tuple(a[j] + (b[j] - a[j]) * m for j in range(3))


def pal(h, s, v=1.0):
    return tuple(v * c ** (1.0 + 1.5 * s) for c in palette(h))


def hexc(c, boost=1.0):
    return "#" + "".join(f"{min(255, round(255 * min(1.0, x * boost))):02x}" for x in c)


def f1(x):
    return f"{x:.1f}".rstrip("0").rstrip(".")


# --- Synthetic music: 4 s loop, a kick every beat -----------------------------
LOOP = 4.0
FPS = 25
FRAMES = int(LOOP * FPS)
KICKS = [(0.0, 1.0), (1.0, 0.62), (2.0, 0.88), (3.0, 0.7)]  # (time, power)
KICK_DECAY = 6.0


def last_kick(t):
    """(age, power, index) of the most recent kick, wrapping around the loop."""
    best = None
    for i, (kt, kp) in enumerate(KICKS):
        age = (t - kt) % LOOP
        if best is None or age < best[0]:
            best = (age, kp, i)
    return best


def kick_env(t):
    age, power, _ = last_kick(t)
    return power * math.exp(-age * KICK_DECAY)


def treble(t):
    return 0.45 + 0.25 * math.sin(TAU * t / LOOP * 8) * math.sin(TAU * t / LOOP * 3)


def flow(t):
    # Wave phase advanced by energy: steady drift plus a surge after each kick.
    # Total over the loop is 8π so every ribbon (phase x1, x1.5, x2) returns to its start.
    surge = 0.6
    age, _, _ = last_kick(t)
    passed = sum(1 for kt, _ in KICKS if kt < t - age - 1e-9)
    g = (1 - math.exp(-4 * age)) / (1 - math.exp(-4))
    c = (4 * TAU - surge * len(KICKS)) / LOOP
    return c * t + surge * (passed + g)


def spectrum(s, t):
    k = kick_env(t)
    bass = math.exp(-s * 3.2) * (0.42 + 0.55 * k)
    mids = 0.22 * (0.5 + 0.5 * math.sin(s * 11 - TAU * t / LOOP * 2)) * math.exp(-s * 1.2)
    highs = 0.12 * treble(t) * (0.5 + 0.5 * math.sin(s * 23 + TAU * t / LOOP * 6))
    return bass + mids + highs


# --- Hero banner ---------------------------------------------------------------
W, H = 1200, 200
BX, BY, BW, BH, BR = 24, 24, 1152, 76, 18   # the "bar"
CX = BW / BH / 2                            # half width in bar-heights
N = 84                                      # ribbon sample points
BASS_STRETCH = 1.4


def amp_at(s, t):
    age, power, _ = last_kick(t)
    k = kick_env(t)
    front = 1 - math.exp(-age * 4.5)
    blast = power * math.exp(-age * 2.2)
    ds = s - front
    return min(1.0, 1.3 * spectrum(s ** BASS_STRETCH, t) * (1 + 0.7 * k)
               + 0.6 * blast * math.exp(-ds * ds / 0.003))


def ribbon_path(k, t):
    freq = 2.6 + k * 1.4
    phase = flow(t) * (1 + k * 0.5) + k * 2.1
    tr = treble(t)
    pts = []
    for i in range(N + 1):
        x = BW * i / N
        dx = abs(x / BH - CX)
        s = dx / CX
        a = amp_at(s, t)
        wave = math.sin(dx * freq - phase) + 0.3 * math.sin(dx * freq * 2.3 - phase * 2) * tr
        y = 0.5 + 0.42 * a * wave
        pts.append(f"{f1(BX + x)} {f1(BY + y * BH)}")
    return "M" + "L".join(pts)


def aura_path(t):
    n = 48
    top, bot = [], []
    for i in range(n + 1):
        x = BW * i / n
        s = abs(x / BH - CX) / CX
        a = amp_at(s, t)
        half = (a * 0.5 + 0.02) * BH * 0.8
        top.append(f"{f1(BX + x)} {f1(BY + BH / 2 - half)}")
        bot.append(f"{f1(BX + x)} {f1(BY + BH / 2 + half)}")
    return "M" + "L".join(top) + "L" + "L".join(reversed(bot)) + "Z"


def frames(fn):
    return ";".join(fn(i / FPS) for i in range(FRAMES + 1))


def anim(attr, values, dur=LOOP, key_times=None, extra=""):
    kt = f' keyTimes="{key_times}"' if key_times else ""
    return (f'<animate attributeName="{attr}" dur="{dur}s" repeatCount="indefinite"'
            f' values="{values}"{kt}{extra}/>')


def color_anim(attr, offset, s_pos, hue_dur=24.0, steps=48):
    vals = ";".join(hexc(pal(i / steps + offset + s_pos * 0.6, 0.9), 1.15) for i in range(steps + 1))
    return anim(attr, vals, hue_dur)


def ribbon_gradient(gid, k):
    stops = []
    for j in range(9):
        off = j / 8
        s = abs(off - 0.5) * 2
        stops.append(f'<stop offset="{off:.3f}">{color_anim("stop-color", k * 0.33, s)}</stop>')
    return (f'<linearGradient id="{gid}" gradientUnits="userSpaceOnUse" x1="{BX}" y1="0" '
            f'x2="{BX + BW}" y2="0">{"".join(stops)}</linearGradient>')


def shockwave(power_scale=1.0):
    """Chromatic front: three thin glowing bars per side, eased outward on every kick."""
    out = []
    for side in (-1, 1):
        for lag, col, gain in ((0.0, LAVENDER, 1.0), (0.018, MAUVE, 0.85), (0.036, BLUE, 0.75)):
            xs, ops = [], []
            for i in range(FRAMES + 1):
                t = i / FPS
                age, power, _ = last_kick(t)
                front = 1 - math.exp(-age * 4.5) - lag
                blast = power * math.exp(-age * 2.2)
                x = BX + BW / 2 + side * max(0.0, front) * BW / 2
                xs.append(f1(x - 3))
                ops.append(f"{min(1.0, blast * gain * power_scale):.2f}")
            out.append(
                f'<rect y="{BY}" width="6" height="{BH}" rx="3" fill="{hexc(tuple(c ** 1.6 for c in col), 1.2)}">'
                f'{anim("x", ";".join(xs))}{anim("opacity", ";".join(ops))}</rect>')
    return "".join(out)


def bounce(y):
    return 1 - abs(1 - (y % 2))


def particles(rng):
    """Sparks flung out of the centre on each kick, streaking and bouncing (as in viz.frag)."""
    out = []
    life_span = 1.6
    samples = 24
    for kt, kp in KICKS:
        for _ in range(14):
            r1, r2, r3, r4 = (rng.random() for _ in range(4))
            d = -1 if r1 < 0.5 else 1
            rate = (2 + 3 * r2) * (0.6 + 0.4 * kp)
            reach = CX * (0.25 + 0.75 * r3)
            col = hexc(pal(r1 * 0.5 + r4 * 0.5, 0.8), 1.2)
            x1s, x2s, ys, ops, kts = [], [], [], [], []
            # Hold invisible until the kick, sample the flight, then hold invisible again.
            times = [0.0] if kt > 0 else []
            times += [kt + life_span * (j / (samples - 1)) ** 1.6 for j in range(samples)]
            if times[-1] < LOOP:
                times.append(LOOP)
            for t in times:
                age = t - kt
                active = 0 <= age <= life_span
                if not active:
                    age = 0.0
                ease = math.exp(-age * rate)
                travel = reach * (1 - ease)
                speed = reach * rate * ease
                px = BX + BW / 2 + d * travel * BH
                py = BY + BH * bounce(0.5 + (r4 - 0.5) * 0.5 + (r4 - 0.5) * 3 * (1 - math.exp(-age * 3)))
                trail = min(2.5, max(0.05, speed * 0.025)) * BH
                life = kp * math.exp(-age * (1.4 + 1.6 * r2)) if active and age < life_span * 0.98 else 0.0
                x1s.append(f1(px))
                x2s.append(f1(px - d * trail))
                ys.append(f1(py))
                ops.append(f"{min(1.0, life * 1.3):.2f}")
                kts.append(f"{t / LOOP:.4f}")
            keyt = ";".join(kts)
            ylist = ";".join(ys)
            out.append(
                f'<line stroke="{col}" stroke-width="{2.2 + 1.6 * r3:.1f}" stroke-linecap="round" opacity="0">'
                f'{anim("x1", ";".join(x1s), key_times=keyt)}{anim("x2", ";".join(x2s), key_times=keyt)}'
                f'{anim("y1", ylist, key_times=keyt)}{anim("y2", ylist, key_times=keyt)}'
                f'{anim("opacity", ";".join(ops), key_times=keyt)}</line>')
    return "".join(out)


def sparks(rng):
    out = []
    for _ in range(26):
        x = BX + 10 + rng.random() * (BW - 20)
        y = BY + 8 + rng.random() * (BH - 16)
        dur = 0.8 + rng.random() * 2.2
        begin = rng.random() * dur
        col = hexc(pal(rng.random(), 0.6), 1.2)
        out.append(
            f'<circle cx="{f1(x)}" cy="{f1(y)}" r="{1.2 + rng.random() * 1.4:.1f}" fill="{col}" opacity="0">'
            f'<animate attributeName="opacity" dur="{dur:.2f}s" begin="-{begin:.2f}s" repeatCount="indefinite" '
            f'values="0;0;0.95;0;0" keyTimes="0;0.78;0.82;0.9;1"/></circle>')
    return "".join(out)


def kick_flash():
    ops = ";".join(f"{min(1.0, kick_env(i / FPS) ** 2 * 0.55):.3f}" for i in range(FRAMES + 1))
    return (f'<rect x="{BX}" y="{BY}" width="{BW}" height="{BH}" fill="url(#haze)" opacity="0">'
            f'{anim("opacity", ops)}</rect>')


def bar_widgets():
    """A stand-in for the transparent DankBar drawn on top."""
    text = "#cdd6f4"
    sub = "#a6adc8"
    cy = BY + BH / 2
    w = []
    # Left: launcher + workspaces
    w.append(f'<circle cx="{BX + 34}" cy="{cy}" r="13" fill="#11111b" fill-opacity="0.55"/>'
             f'<path d="M{BX + 28} {cy - 4}h12M{BX + 28} {cy}h12M{BX + 28} {cy + 4}h12" stroke="{text}" '
             f'stroke-width="2" stroke-linecap="round"/>')
    w.append(f'<rect x="{BX + 58}" y="{cy - 13}" width="120" height="26" rx="13" fill="#11111b" fill-opacity="0.55"/>')
    w.append(f'<rect x="{BX + 66}" y="{cy - 5}" width="34" height="10" rx="5" fill="#b4befe">'
             f'<animate attributeName="width" dur="8s" repeatCount="indefinite" values="34;34;10;10;34" '
             f'keyTimes="0;0.45;0.5;0.95;1"/></rect>')
    for i, x in enumerate((108, 126, 144, 162)):
        w.append(f'<circle cx="{BX + x}" cy="{cy}" r="5" fill="{sub}" fill-opacity="0.7"/>')
    # Centre: clock + now playing
    w.append(f'<rect x="{BX + BW / 2 - 150}" y="{cy - 15}" width="300" height="30" rx="15" '
             f'fill="#11111b" fill-opacity="0.55"/>')
    w.append(f'<text x="{BX + BW / 2 - 132}" y="{cy + 5}" fill="{text}" font-size="14" font-weight="700">21:37</text>')
    w.append(f'<circle cx="{BX + BW / 2 - 70}" cy="{cy}" r="2" fill="{sub}"/>')
    w.append(f'<text x="{BX + BW / 2 - 56}" y="{cy + 5}" fill="{sub}" font-size="13">&#9834; Now playing</text>')
    for i in range(4):
        h0 = 4 + i % 2 * 4
        w.append(f'<rect x="{BX + BW / 2 + 98 + i * 6}" y="{cy - h0 / 2}" width="3" height="{h0}" rx="1.5" fill="#cba6f7">'
                 f'<animate attributeName="height" dur="{0.5 + i * 0.13:.2f}s" repeatCount="indefinite" values="4;12;6;10;4"/>'
                 f'<animate attributeName="y" dur="{0.5 + i * 0.13:.2f}s" repeatCount="indefinite" '
                 f'values="{cy - 2};{cy - 6};{cy - 3};{cy - 5};{cy - 2}"/></rect>')
    # Right: tray
    w.append(f'<rect x="{BX + BW - 186}" y="{cy - 13}" width="128" height="26" rx="13" fill="#11111b" fill-opacity="0.55"/>')
    for i, x in enumerate((-166, -142, -118, -94, -70)):
        w.append(f'<circle cx="{BX + BW + x + 6}" cy="{cy}" r="5.5" fill="none" stroke="{sub}" stroke-width="1.8"/>')
    w.append(f'<circle cx="{BX + BW - 34}" cy="{cy}" r="13" fill="#11111b" fill-opacity="0.55"/>'
             f'<path d="M{BX + BW - 34} {cy - 6}v5" stroke="{text}" stroke-width="2" stroke-linecap="round"/>'
             f'<path d="M{BX + BW - 38.5} {cy - 3.5}a6 6 0 1 0 9 0" fill="none" stroke="{text}" stroke-width="2" '
             f'stroke-linecap="round"/>')
    return "".join(w)


def hero():
    rng = random.Random(7)
    ribbons = []
    for k in range(3):
        d = frames(lambda t, k=k: ribbon_path(k, t))
        ribbons.append(f'<path fill="none" stroke="url(#rib{k})" stroke-width="2.4" stroke-linejoin="round">'
                       f'{anim("d", d)}</path>')
    ribbons_svg = "".join(ribbons)
    aura = f'<path fill="url(#auraGrad)" opacity="0.32">{anim("d", frames(aura_path))}</path>'

    wall_blobs = (
        f'<circle cx="220" cy="190" r="170" fill="#cba6f7" opacity="0.10">'
        f'<animate attributeName="cx" dur="18s" repeatCount="indefinite" values="220;320;220"/></circle>'
        f'<circle cx="980" cy="210" r="200" fill="#89b4fa" opacity="0.10">'
        f'<animate attributeName="cx" dur="22s" repeatCount="indefinite" values="980;860;980"/></circle>'
        f'<circle cx="600" cy="260" r="160" fill="#f5c2e7" opacity="0.06">'
        f'<animate attributeName="r" dur="14s" repeatCount="indefinite" values="160;200;160"/></circle>')

    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}" role="img" aria-label="Animated preview: neon ribbons, shockwaves and sparks pulsing behind a top bar">
<title>dms-bar-visualizer preview</title>
<defs>
  <clipPath id="frame"><rect width="{W}" height="{H}" rx="18"/></clipPath>
  <clipPath id="bar"><rect x="{BX}" y="{BY}" width="{BW}" height="{BH}" rx="{BR}"/></clipPath>
  <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#181825"/><stop offset="1" stop-color="#11111b"/>
  </linearGradient>
  <radialGradient id="haze" cx="0.5" cy="0.5" r="0.6">
    <stop offset="0" stop-color="#cba6f7" stop-opacity="0.9"/>
    <stop offset="0.5" stop-color="#b4befe" stop-opacity="0.35"/>
    <stop offset="1" stop-color="#89b4fa" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="auraGrad" gradientUnits="userSpaceOnUse" x1="{BX}" y1="0" x2="{BX + BW}" y2="0">
    <stop offset="0" stop-color="#89b4fa"/><stop offset="0.3" stop-color="#cba6f7"/>
    <stop offset="0.5" stop-color="#b4befe"/><stop offset="0.7" stop-color="#cba6f7"/>
    <stop offset="1" stop-color="#89b4fa"/>
  </linearGradient>
  {"".join(ribbon_gradient(f"rib{k}", k) for k in range(3))}
  <filter id="glow" x="-5%" y="-60%" width="110%" height="220%">
    <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="wide"/>
    <feGaussianBlur in="SourceGraphic" stdDeviation="1.6" result="tight"/>
    <feMerge><feMergeNode in="wide"/><feMergeNode in="wide"/><feMergeNode in="tight"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="soft" x="-10%" y="-50%" width="120%" height="200%"><feGaussianBlur stdDeviation="9"/></filter>
  <filter id="blur40"><feGaussianBlur stdDeviation="40"/></filter>
</defs>
<g clip-path="url(#frame)" font-family="Inter, 'Segoe UI', Roboto, Ubuntu, sans-serif">
  <rect width="{W}" height="{H}" fill="url(#wall)"/>
  <g filter="url(#blur40)">{wall_blobs}</g>
  <g clip-path="url(#bar)">
    <rect x="{BX}" y="{BY}" width="{BW}" height="{BH}" fill="#11111b" opacity="0.35"/>
    {kick_flash()}
    <g filter="url(#soft)">{aura}</g>
    <g filter="url(#glow)">{ribbons_svg}</g>
    <g filter="url(#glow)">{shockwave()}</g>
    <g filter="url(#glow)">{particles(rng)}{sparks(rng)}</g>
  </g>
  <rect x="{BX + 0.5}" y="{BY + 0.5}" width="{BW - 1}" height="{BH - 1}" rx="{BR}" fill="none" stroke="#cdd6f4" stroke-opacity="0.07"/>
  {bar_widgets()}
  <text x="{W / 2}" y="{H - 44}" text-anchor="middle" fill="#cdd6f4" fill-opacity="0.92" font-size="30" font-weight="700" letter-spacing="0.5">dms-bar-visualizer</text>
  <text x="{W / 2}" y="{H - 18}" text-anchor="middle" fill="#a6adc8" font-size="15">a shader audio visualizer living behind the DankMaterialShell top bar</text>
</g>
</svg>
'''


# --- Layer diagram ---------------------------------------------------------------
def layers():
    w, h = 900, 300
    layers_def = [
        # label, sublabel, fill, stroke, rest offset
        ("top layer", "DankBar · transparent background", "#cdd6f4", "#cdd6f4", -1),
        ("bottom layer", "bar-visualizer · click-through", "#cba6f7", "#b4befe", 0),
        ("background", "wallpaper", "#89b4fa", "#89b4fa", 1),
    ]
    pw, ph, skew = 420, 70, 90
    cx0, cy0 = 120, 150
    out = []
    # Draw back-to-front so the top layer ends up on top.
    for idx in (2, 1, 0):
        label, sub, fill, stroke, off = layers_def[idx]
        y_rest = off * 22
        y_split = off * 72
        x0 = cx0
        poly = f"{x0 + skew},{cy0 - ph / 2} {x0 + skew + pw},{cy0 - ph / 2} {x0 + pw},{cy0 + ph / 2} {x0},{cy0 + ph / 2}"
        inner = ""
        if idx == 1:
            # A little ribbon on the visualizer layer.
            d = []
            for f in range(41):
                ph_ = TAU * f / 40
                pts = []
                for i in range(41):
                    u = i / 40
                    xx = x0 + 30 + u * (pw - 60) + skew * 0.5
                    yy = cy0 + 18 * math.sin(abs(u - 0.5) * 18 - ph_ * 2) * (0.35 + 0.65 * math.exp(-abs(u - 0.5) * 4))
                    pts.append(f"{f1(xx)} {f1(yy)}")
                d.append("M" + "L".join(pts))
            inner = (f'<path fill="none" stroke="#f5c2e7" stroke-width="2.4" filter="url(#lglow)">'
                     f'<animate attributeName="d" dur="2.4s" repeatCount="indefinite" values="{";".join(d)}"/></path>')
        if idx == 0:
            inner = (f'<rect x="{x0 + skew * 0.5 + 30}" y="{cy0 - 8}" width="80" height="16" rx="8" fill="#cdd6f4" fill-opacity="0.5"/>'
                     f'<rect x="{x0 + skew * 0.5 + pw / 2 - 50}" y="{cy0 - 8}" width="100" height="16" rx="8" fill="#cdd6f4" fill-opacity="0.5"/>'
                     f'<rect x="{x0 + skew * 0.5 + pw - 110}" y="{cy0 - 8}" width="80" height="16" rx="8" fill="#cdd6f4" fill-opacity="0.5"/>')
        fill_op = {0: 0.06, 1: 0.10, 2: 0.16}[idx]
        tx = x0 + pw + skew + 40
        vals = f"0 {y_rest};0 {y_rest};0 {y_split};0 {y_split};0 {y_rest}"
        out.append(
            f'<g><animateTransform attributeName="transform" type="translate" dur="7s" repeatCount="indefinite" '
            f'values="{vals}" keyTimes="0;0.15;0.4;0.75;1" calcMode="spline" '
            f'keySplines="0 0 1 1;0.65 0 0.35 1;0 0 1 1;0.65 0 0.35 1"/>'
            f'<polygon points="{poly}" fill="{fill}" fill-opacity="{fill_op}" stroke="{stroke}" stroke-opacity="0.7" '
            f'stroke-width="1.5" stroke-linejoin="round"/>{inner}'
            f'<line x1="{x0 + pw + skew / 2 + 8}" y1="{cy0}" x2="{tx - 8}" y2="{cy0}" stroke="{stroke}" stroke-opacity="0.35" stroke-dasharray="3 4"/>'
            f'<text x="{tx}" y="{cy0 - 3}" fill="{stroke}" font-size="17" font-weight="700">{label}</text>'
            f'<text x="{tx}" y="{cy0 + 18}" fill="#a6adc8" font-size="13">{sub}</text></g>')
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="Layer diagram: the transparent DankBar on the top layer, the visualizer on the bottom layer, the wallpaper below">
<title>Wayland layers</title>
<defs>
  <filter id="lglow" x="-10%" y="-80%" width="120%" height="260%">
    <feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="{w}" height="{h}" rx="18" fill="#181825"/>
<g font-family="Inter, 'Segoe UI', Roboto, Ubuntu, sans-serif">{"".join(out)}</g>
</svg>
'''


if __name__ == "__main__":
    (OUT / "hero.svg").write_text(hero())
    (OUT / "layers.svg").write_text(layers())
    for name in ("hero.svg", "layers.svg"):
        print(f"{name}: {(OUT / name).stat().st_size / 1024:.0f} KiB")

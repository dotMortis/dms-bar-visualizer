// The one-time check of the core against v0.10.0 (#65, spec #41): before the old JS goes, run it
// and the core side by side on every recorded fixture and compare what both visualizers draw from.
//
//     node core/compare-v0.10.0.mjs
//
// Not part of the regular test run. Builds the WASM (core/build-wasm.sh), takes v0.10.0's JS
// modules from the `v0.10.0` git tag (`git archive`, into a temporary directory; never the
// working tree's), and drives both with the same schedule:
//   - every fixture (tests/fixtures), on the Bar Visualizer at three configs and on the Lock Ring
//     at two (100 % and some lockRing percentages), each at 60 and 144 Hz display frames;
//   - capture lines pushed at their recorded times, display frames of exactly 1/fps seconds, and
//     a playback position reading of the demo song (looping, as docs/demo-lyrics.mjs) each second,
//     all on one timeline: a capture line or a reading due at a frame's time comes before it.
// The old JS side mirrors the QML of v0.10.0: audio/AudioPipeline.qml (onValuesChanged on a
// capture line, FrameAnimation on a display frame), shell.qml's viz.frag inputs and
// lyrics/LyricWordsLayer.qml + BarLyrics.qml for the bar; lock-ring/LockAudio.qml, LockRing.qml
// and LockLyrics.qml for the Lock Ring. Date.now() is the display clock (the frame times summed,
// what the core runs on), the local time of day runs from 23:59:45 so the Hands cross midnight.
//
// Compared after every display frame: the Kicks (times must be identical: else exit 1), the shader
// inputs of viz.frag or ring.frag, the Lock Ring's Hands, Hour Points and Digital Time, and every
// Lyric Words glyph. Any other number further apart than TOLERANCE is listed, by quantity.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.TZ = "UTC";
const core = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(core, "..");
const fixtures = path.join(repo, "tests/fixtures");
const pkg = path.join(core, "target/wasm-web");
const BANDS = 32;
// Numbers this close (absolute, or relative to the larger) count as the same: f64 math done in
// another order or through libm instead of V8's Math gives ~1e-15 relative.
const TOLERANCE = 1e-9;
// --wall-clock: v0.10.0's Date.now() as it ran, whole milliseconds of the timeline at each capture
// line, reading and frame, instead of the core's own clock (the display frame times summed). Shows
// what that intended change (#62) does to the Lyric Words.
const WALL_CLOCK = process.argv.includes("--wall-clock");

function run(cmd, args, options = {}) {
    try {
        return execFileSync(cmd, args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28, ...options });
    } catch (e) {
        console.error(`compare: ${path.basename(cmd)} ${args.join(" ")} failed (${e.status ?? e.code})`);
        process.exit(2);
    }
}

// --- Both sides ---------------------------------------------------------------------------------
run(path.join(core, "build-wasm.sh"), [pkg]);
const { initSync, Visualizer } = await import(path.join(pkg, "visualizer_core.js"));
initSync({ module: fs.readFileSync(path.join(pkg, "visualizer_core_bg.wasm")) });

const old = fs.mkdtempSync(path.join(os.tmpdir(), "v0.10.0-"));
process.on("exit", () => fs.rmSync(old, { recursive: true, force: true }));
const archive = path.join(old, "docs.tar");
run("git", ["archive", "-o", archive, "v0.10.0", "docs"]);
run("tar", ["-xf", archive, "-C", old]);
const js = async name => import(path.join(old, "docs", name));
const { createKickDetector } = await js("kick.mjs");
const { DEFAULTS, parseConfig, lockRingSettings } = await js("config.mjs");
const { createLyricWords } = await js("lyric-words.mjs");
const { DEMO_LINES, DEMO_LOOP } = await js("demo-lyrics.mjs");
const BarRibbons = await js("bar-ribbons.mjs");
const BarWords = await js("bar-words.mjs");
const Ring = await js("lock-ring/ring.mjs");
const Kicks = await js("lock-ring/kicks.mjs");
const Hands = await js("lock-ring/hands.mjs");
const Clock = await js("lock-ring/clock.mjs");
const RingLyrics = await js("lock-ring/lyrics.mjs");

// --- The runs -----------------------------------------------------------------------------------
const BAR_CONFIGS = {
    defaults: "{}",
    sensitive: `{"kickThreshold": 0.2, "kickLowHz": 30}`,
    tuned: `{"speed": 1.3, "kickDecay": 5, "bassStretch": 1.6, "intensity": 0.8, "kickCooldown": 0.15}`,
};
const RING_CONFIGS = {
    "100%": "{}",
    percentages: `{"speed": 0.8, "kickDecay": 5, "bassStretch": 1.6, "lockRing": {"intensityPercent": 120, ` +
        `"kickThresholdPercent": 80, "kickLowHzPercent": 150, "kickHighHzPercent": 90, "kickCooldownPercent": 150, "handWaves": 1.4}}`,
};
const RATES = [60, 144];
const BAR = { width: 1920, height: DEFAULTS.barThickness };
const RING_SIDE = Math.round(1080 * DEFAULTS.lockRing.ringSize);
const SEED = 42;
const SONG_START = 0.5;            // the song's position at the first frame
const TAIL = 2;                    // display seconds after the last capture line
const LOCAL_START = 23 * 3600 + 59 * 60 + 45;
// The font: every letter of the song, an advance in ems each (any will do, the same on both
// sides), and a line height in ems.
const LETTERS = [...new Set(DEMO_LINES.flatMap(line => Array.from(line.x.replace(/\s/g, ""))))].join("");
const ADVANCES = Array.from(LETTERS, c => 0.42 + 0.03 * (c.codePointAt(0) % 11));
const LINE_HEIGHT = 1.25;
const advanceOf = c => { const i = LETTERS.indexOf(c); return i < 0 ? 0.5 : ADVANCES[i]; };
const LYRICS = { found: true, synced: DEMO_LINES };
// A reading each second, a little off the true position as a player's are (never by a seek's).
const reading = (song, n) => song + 0.03 * Math.sin(n * 1.7);

function frames(scenario) {
    const [, ...lines] = fs.readFileSync(path.join(fixtures, `${scenario}.txt`), "utf8").trimEnd().split("\n");
    const out = [];
    for (const line of lines) {
        const [time, raw] = line.split(" ");
        const parts = raw.split(";");
        if (parts.length < BANDS || parts[BANDS - 1] === "")
            continue;
        out.push({ time: Number(time), values: Array.from(parts.slice(0, BANDS), p => parseInt(p, 10) / 1000) });
    }
    return out;
}

// --- v0.10.0, as its QML ran it -----------------------------------------------------------------
// audio/AudioPipeline.qml: the capture line handler and the FrameAnimation.
function oldPipeline(settings) {
    const effective = Object.assign({}, DEFAULTS, settings);
    const detector = createKickDetector(DEFAULTS);
    detector.configure(effective);
    const s = {
        values: new Array(BANDS).fill(0), bass: 0, mid: 0, treble: 0, kick: 0, time: 0, flow: 0,
        kickTimes: new Array(8).fill(-100), kickPowers: new Array(8).fill(0), kickSeeds: new Array(8).fill(0), kickCount: 0,
        get kickAges() { return this.kickTimes.map(t => this.time - t); },
    };
    const avg = (from, to) => { let sum = 0; for (let i = from; i < to; i++) sum += s.values[i]; return sum / (to - from); };
    return {
        s,
        push(values, time) {
            s.values = values;
            s.bass = avg(0, 6);
            s.mid = avg(6, 16);
            s.treble = avg(16, BANDS);
            const hit = detector.push(values, time);
            if (!hit)
                return null;
            s.kick = 1;
            s.kickCount = (s.kickCount + 1) % 1000;
            const slot = s.kickCount % 8;
            s.kickTimes[slot] = s.time;
            s.kickPowers[slot] = hit.power;
            s.kickSeeds[slot] = s.kickCount;
            return hit.power;
        },
        advance(dt) {
            s.time += dt * effective.speed;
            s.flow = (s.flow + dt * effective.speed * (8 * s.bass + 4 * s.mid + 6 * s.kick)) % (40 * Math.PI);
            s.kick *= Math.exp(-dt * effective.kickDecay);
        },
    };
}

const hexRgb = hex => [1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16) / 255);
const flat = (...xs) => xs.flat();

// The bar's glyphs as lyrics/LyricWordsLayer.qml laid them out, in the core's Glyph fields.
function oldBarGlyphs(words, p, bassStretch) {
    const s = p.s;
    const em = Math.max(8, Math.round(BAR.height * BarWords.LOOK.font));
    const measure = c => advanceOf(c) * em;
    const inputs = {
        width: BAR.width, height: BAR.height, values: s.values, time: s.time % 1200, kick: s.kick, treble: s.treble,
        flow: s.flow, bassStretch, kickAges: s.kickAges, kickPowers: s.kickPowers,
    };
    const out = [];
    words.forEach((entry, index) => {
        const letters = Array.from(entry.text);
        const advances = letters.map(measure);
        const rows = BarWords.rowWidths({ row: entry.spot.row, before: entry.spot.before }, measure, em);
        const glyphs = BarWords.layWord({ ribbon: entry.spot.ribbon, x: entry.spot.x }, advances,
            Object.assign({ clearance: LINE_HEIGHT * em * 0.32 }, inputs), rows);
        if (!glyphs.length)
            return;
        const middle = (glyphs[0].x + glyphs[glyphs.length - 1].x) / 2;
        const middleY = glyphs.reduce((a, g) => a + g.y, 0) / glyphs.length;
        const look = BarWords.wordLook(entry, BarRibbons.shockwaveCrossing(middle, inputs));
        if (!(look.opacity > 0))
            return;
        const rgb = BarRibbons.ribbonColor(middle, entry.spot.ribbon, inputs);
        const whiten = 0.55 + 0.45 * look.white;
        const outward = middle < BAR.width / 2 ? -1 : 1;
        glyphs.forEach((g, i) => out.push({
            letter: letters[i].codePointAt(0), word: index, x: g.x, y: g.y, angle: g.angle, scale: look.scale,
            pivotX: middle, pivotY: middleY, color: rgb, core: rgb.map(c => c + (1 - c) * whiten),
            opacity: Math.min(1, look.opacity), glow: look.glow, glowSpread: 1 + 0.06 * Math.max(0, look.glow - 0.5),
            blur: look.blur, white: look.white, em,
            glowRadius: Math.max(1, Math.round(0.45 * em)), copyBlur: Math.max(1, Math.round(0.08 * em)),
            copies: look.copies.map(c => ({ color: hexRgb(c.color), dx: c.offset * em * outward, dy: 0, opacity: c.opacity })),
        }));
    });
    return out;
}

// The Lock Ring's glyphs as lock-ring/LockRing.qml laid them out.
function oldRingGlyphs(words, scene) {
    const glowColor = hexRgb(Clock.TIME_HIT.glow.color);
    const out = [];
    words.forEach((entry, index) => {
        const em = Math.max(8, RING_SIDE * RingLyrics.WORD_FONT * entry.size);
        const letters = Array.from(entry.text);
        const place = RingLyrics.wordPlacement(entry.spot, letters.map(c => advanceOf(c) * em), scene);
        const crossing = Kicks.shockwaveCrossing(place.radius, scene.kickAges, scene.kickPowers, scene.kickSeeds, place.theta);
        const look = RingLyrics.wordLook(entry, crossing);
        if (!(look.opacity > 0))
            return;
        const base = hexRgb(place.color);
        const tint = look.hit.glow.opacity * 0.6;
        const whiten = RingLyrics.WORD_LOOK.core + (1 - RingLyrics.WORD_LOOK.core) * look.white;
        const out1 = Math.max(1, Math.hypot(place.x, place.y));
        place.glyphs.forEach((g, i) => out.push({
            letter: letters[i].codePointAt(0), word: index, x: g.x, y: g.y, angle: g.rotation, scale: look.scale,
            pivotX: place.x, pivotY: place.y, color: base.map((c, k) => c + (glowColor[k] - c) * tint),
            core: base.map(c => c + (1 - c) * whiten), opacity: Math.min(1, look.opacity), glow: 1,
            glowSpread: look.hit.glow.scale + RingLyrics.WORD_LOOK.glow.spread, blur: look.blur, white: look.white, em,
            glowRadius: Math.max(1, Math.round(RingLyrics.WORD_LOOK.glow.radius * em)),
            copyBlur: Math.max(1, Math.round(Clock.TIME_HIT.soften * em)),
            copies: look.hit.copies.map(c => ({
                color: hexRgb(c.color), dx: place.x / out1 * c.offset * em, dy: place.y / out1 * c.offset * em, opacity: c.opacity,
            })),
        }));
    });
    return out;
}

// The core's glyphs, in the same shape.
const GLYPH_KEYS = ["letter", "word", "x", "y", "angle", "scale", "pivotX", "pivotY", "color", "core", "opacity",
    "glow", "glowSpread", "blur", "white", "em", "glowRadius", "copyBlur", "copies"];
function coreGlyphs(v) {
    const { count, stride, data } = v.glyphs();
    const out = [];
    for (let g = 0; g < count; g++) {
        const at = k => data[g * stride + k];
        const copies = [0, 1, 2].map(c => {
            const b = 22 + 6 * c;
            return { color: [at(b), at(b + 1), at(b + 2)], dx: at(b + 3), dy: at(b + 4), opacity: at(b + 5) };
        });
        out.push({
            letter: at(0), word: at(1), x: at(2), y: at(3), angle: at(4), scale: at(5), pivotX: at(6), pivotY: at(7),
            color: [at(8), at(9), at(10)], core: [at(11), at(12), at(13)], opacity: at(14), glow: at(15), glowSpread: at(16),
            blur: at(17), white: at(18), em: at(19), glowRadius: at(20), copyBlur: at(21), copies,
        });
    }
    return out;
}

// --- Differences --------------------------------------------------------------------------------
// By quantity: { frames (how many times: frames, or glyphs in frames), max, at (where the largest
// was), runs (set) }.
const differences = new Map();
const kickFailures = [];
let compared = 0, framesRun = 0, kicksCompared = 0, glyphsCompared = 0;
const near = (a, b) => a === b || Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b)) || (Number.isNaN(a) && Number.isNaN(b));

function differ(quantity, run, frame, size, detail) {
    let d = differences.get(quantity);
    if (!d)
        differences.set(quantity, d = { frames: 0, max: -1, at: "", runs: new Set() });
    d.frames++;
    d.runs.add(run);
    if (size > d.max) {
        d.max = size;
        d.at = `${run} frame ${frame}${detail ? `: ${detail}` : ""}`;
    }
}

// Compares two numbers or arrays of numbers under one quantity's name: one difference per frame.
function compare(quantity, run, frame, core, old) {
    const a = [core].flat(), b = [old].flat();
    let worst = 0, where = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        compared++;
        if (!near(a[i], b[i])) {
            const d = Math.abs(a[i] - b[i]);
            if (!(d <= worst)) { worst = Number.isNaN(d) ? Infinity : d; where = i; }
        }
    }
    if (where >= 0)
        differ(quantity, run, frame, worst, a.length > 1 ? `[${where}] core ${a[where]}, v0.10.0 ${b[where]}` : `core ${a[where]}, v0.10.0 ${b[where]}`);
}

function compareGlyphs(prefix, run, frame, core, old) {
    if (core.length !== old.length || core.some((g, i) => g.letter !== old[i].letter || g.word !== old[i].word)) {
        const text = gs => {
            const words = [];
            for (const g of gs) (words[g.word] ??= []).push(String.fromCodePoint(g.letter));
            return words.filter(Boolean).map(w => w.join("")).join(" ");
        };
        differ(`${prefix} glyphs shown`, run, frame, Math.abs(core.length - old.length), `core "${text(core)}", v0.10.0 "${text(old)}"`);
        return;
    }
    glyphsCompared += core.length;
    for (let i = 0; i < core.length; i++) {
        for (const key of GLYPH_KEYS.slice(2)) {
            if (key === "copies") {
                for (const field of ["color", "dx", "dy", "opacity"])
                    compare(`${prefix} glyph copies.${field}`, run, frame, core[i].copies.map(c => c[field]).flat(), old[i].copies.map(c => c[field]).flat());
            } else {
                compare(`${prefix} glyph ${key}`, run, frame, core[i][key], old[i][key]);
            }
        }
    }
}

// --- One run ------------------------------------------------------------------------------------
function replay(scenario, kind, configName, text, fps) {
    const name = `${scenario} ${kind} ${configName} ${fps} Hz`;
    const ring = kind === "lock-ring";
    const settings = parseConfig(text);
    const pipeline = oldPipeline(ring ? lockRingSettings(settings) : settings);
    const s = pipeline.s;
    const tracker = createLyricWords({ placement: ring ? "ribbons-or-hands" : "ribbons", seed: SEED });
    const motion = Ring.createRingMotion(), handMotion = Hands.createHandMotion();
    let swell = 0, presence = 0, handLevels = { bass: 0, mid: 0, treble: 0 }, handPhases = { hour: 0, minute: 0, second: 0 };

    const v = new Visualizer();
    v.setKind(kind);
    v.configure(text);
    v.setSeed(SEED);
    v.setBarSize(BAR.width, BAR.height);
    v.setRingSize(RING_SIDE);
    v.setLetters(LETTERS, Float64Array.from(ADVANCES), LINE_HEIGHT);
    v.setPlayer("playing");

    // The display clock both read: the frame times summed, as the core sums them.
    let seconds = 0;
    // v0.10.0's Date.now(), at timeline time `at`.
    const wall = at => WALL_CLOCK ? Math.round(at * 1000) : seconds * 1000;
    // The song's position at timeline time `at`, as the player knows it.
    const song = at => (SONG_START + (WALL_CLOCK ? at : seconds)) % DEMO_LOOP;
    const read = (n, at) => {
        const position = reading(song(at), n);
        tracker.read({ position, wall: wall(at), rate: 1, playing: true });
        v.setPosition(position, 1);
    };
    tracker.setTrack("demo", DEMO_LOOP);
    tracker.setLyrics(LYRICS);
    v.setTrack("demo", DEMO_LOOP);
    v.setLyrics(JSON.stringify(LYRICS));
    read(0, 0);

    const captures = frames(scenario);
    const t0 = captures[0].time, end = captures[captures.length - 1].time - t0 + TAIL;
    let next = 0, readings = 1, kicks = 0, kicksOld = 0, coreCount = v.frame().kickCount;
    for (let k = 1; k / fps <= end; k++) {
        const at = k / fps;
        while (next < captures.length && captures[next].time - t0 <= at) {
            const { time, values } = captures[next++];
            const power = pipeline.push(values, time);
            v.pushBands(Float64Array.from(values), time);
            const f = v.frame();
            const fired = f.kickCount !== coreCount;
            coreCount = f.kickCount;
            if (power !== null) {
                kicksOld++;
                tracker.kick(power, wall(time - t0));
            }
            if (fired)
                kicks++;
            if (fired !== (power !== null)) {
                kickFailures.push(`${name}: at ${time} s a Kick only in ${fired ? "the core" : "v0.10.0"}`);
            } else if (fired) {
                kicksCompared++;
                if (f.kickPower !== power)
                    differ("Kick power (compared exactly)", name, `capture at ${time} s`, Math.abs(f.kickPower - power), `core ${f.kickPower}, v0.10.0 ${power}`);
            }
        }
        while (readings <= at && readings < end) {
            read(readings, readings);
            readings++;
        }

        // A display frame.
        const dt = 1 / fps;
        seconds += dt;
        const ms = Math.round(seconds * 1000);
        const date = new Date(Date.UTC(2026, 10, 6) + LOCAL_START * 1000 + ms);
        v.setLocalTime(date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000);
        v.advance(dt);
        pipeline.advance(dt);
        const levels = { bass: s.bass, mid: s.mid, treble: s.treble };
        if (ring) {
            ({ swell, presence } = motion.step(levels, dt));
            ({ levels: handLevels, phases: handPhases } = handMotion.step(levels, dt, settings.speed));
        }
        const words = tracker.words(wall(at));
        framesRun++;

        const f = v.frame();
        const c = (q, a, b) => compare(q, name, k, a, b);
        const ages = s.kickAges;
        // The inputs both shaders share.
        c("time % 1200", f.time, s.time % 1200);
        c("flow", f.flow, s.flow);
        c("kick", f.kick, s.kick);
        c("treble", f.treble, s.treble);
        c("bands (b0..b7)", Array.from(f.bands), s.values);
        c("bassStretch", f.bassStretch, settings.bassStretch);
        c("intensity", f.intensity, ring ? lockRingSettings(settings).intensity : settings.intensity);
        if (!ring) {
            // viz.frag's (shell.qml).
            c("bass", f.bass, s.bass);
            c("mid", f.mid, s.mid);
            c("bar kickAges", Array.from(f.kickAges), ages);
            c("bar kickPowers", Array.from(f.kickPowers), s.kickPowers);
            c("bar kickSeeds", Array.from(f.kickSeeds), s.kickSeeds);
            compareGlyphs("bar", name, k, coreGlyphs(v), oldBarGlyphs(words, pipeline, settings.bassStretch));
            continue;
        }
        // ring.frag's (LockRing.qml), the Hands, Hour Points and Digital Time.
        const r = v.lockRing();
        const slots = Kicks.kickSlots(ages, s.kickPowers, s.kickSeeds);
        const flash = Kicks.handFlash(ages, s.kickPowers, settings.kickDecay);
        const poses = Hands.handPoses(date, handLevels, { flash, strength: settings.lockRing.handWaves });
        const names = ["hour", "minute", "second"];
        c("swell", r.swell, swell);
        c("presence", r.presence, presence);
        c("ring kickAges (kickSlots)", Array.from(r.kickAges), slots.ages);
        c("ring kickPowers (kickSlots)", Array.from(r.kickPowers), slots.powers);
        c("ring kickSeeds (kickSlots)", Array.from(r.kickSeeds), slots.seeds);
        c("handFlash", r.handFlash, flash);
        c("handAngle (rad)", Array.from(r.handAngles), names.map(n => poses[n].angle * Math.PI / 180));
        c("handInner", Array.from(r.handInner), names.map(n => poses[n].inner));
        c("handLength", Array.from(r.handLengths), names.map(n => poses[n].length));
        c("handAmp", Array.from(r.handAmplitudes), names.map(n => poses[n].amplitude));
        c("handWidth", Array.from(r.handWidths), names.map(n => poses[n].width));
        c("handGlow", Array.from(r.handGlows), names.map(n => poses[n].glow));
        c("handPhase", Array.from(r.handPhases), names.map(n => handPhases[n]));
        c("handLevels", Array.from(r.handLevels), ["bass", "mid", "treble"].map(b => handLevels[b]));
        // Hour Points: drawn by ring.frag from its uniforms (the filtered Kick slots).
        const points = Ring.hourPoints({
            values: s.values, flow: s.flow, time: s.time % 1200, treble: s.treble, swell, presence, bassStretch: settings.bassStretch,
            crossing: (radius, theta) => Kicks.shockwaveCrossing(radius, slots.ages, slots.powers, slots.seeds, theta),
            surge: (radius, theta) => Kicks.ribbonSurge(radius, slots.ages, slots.powers, slots.seeds, theta),
        });
        c("Hour Points radius", Array.from(r.hourRadii), points.map(p => p.radius));
        c("Hour Points glow", Array.from(r.hourGlows), points.map(p => p.glow));
        // Digital Time (LockAudio.timeCrossing, LockRing.qml's timeHit).
        const crossing = Kicks.shockwaveCrossing(Clock.TIME_RADIUS, ages, s.kickPowers, s.kickSeeds, Math.PI);
        const hit = Clock.timeHit(crossing);
        c("Digital Time crossing", r.timeCrossing, crossing);
        c("Digital Time copy offsets", Array.from(r.timeCopyOffsets), hit.copies.map(h => h.offset));
        c("Digital Time copy opacity", flat(r.timeCopyOpacity, r.timeCopyOpacity, r.timeCopyOpacity), hit.copies.map(h => h.opacity));
        c("Digital Time glow opacity", r.timeGlowOpacity, hit.glow.opacity);
        c("Digital Time glow scale", r.timeGlowScale, hit.glow.scale);
        c("Digital Time white", r.timeWhite, hit.white);
        const scene = {
            dialRadius: RING_SIDE * Ring.DIAL_RATIO, values: s.values, flow: s.flow, time: s.time % 1200, treble: s.treble, swell,
            kick: s.kick, bassStretch: settings.bassStretch, kickAges: ages, kickPowers: s.kickPowers, kickSeeds: s.kickSeeds,
            poses, phases: handPhases,
        };
        compareGlyphs("ring", name, k, coreGlyphs(v), oldRingGlyphs(words, scene));
    }
    if (kicks !== kicksOld && !kickFailures.some(f => f.startsWith(name)))
        kickFailures.push(`${name}: ${kicks} Kicks in the core, ${kicksOld} in v0.10.0`);
    v.free();
    return kicks;
}

// --- All of them --------------------------------------------------------------------------------
// Fixtures named on the command line only, if any (every one by default).
const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
const scenarios = fs.readdirSync(fixtures).filter(f => f.endsWith(".txt")).map(f => f.slice(0, -4))
    .filter(s => !only.length || only.includes(s)).sort();
let runs = 0, kicks = 0;
for (const scenario of scenarios) {
    for (const fps of RATES) {
        for (const [name, text] of Object.entries(BAR_CONFIGS)) { kicks += replay(scenario, "bar", name, text, fps); runs++; }
        for (const [name, text] of Object.entries(RING_CONFIGS)) { kicks += replay(scenario, "lock-ring", name, text, fps); runs++; }
    }
}

console.log(`compare${WALL_CLOCK ? " --wall-clock" : ""}: ${runs} runs (${scenarios.length} fixtures x ${Object.keys(BAR_CONFIGS).length} bar + ` +
    `${Object.keys(RING_CONFIGS).length} Lock Ring configs x ${RATES.join("/")} Hz), ${framesRun} display frames, ` +
    `${kicks} Kicks, ${glyphsCompared} glyphs and ${compared} numbers compared, tolerance ${TOLERANCE} (absolute or relative)`);
if (kickFailures.length)
    console.log(`\nKick times differ (${kickFailures.length}):\n${kickFailures.map(f => `  ${f}`).join("\n")}`);
else
    console.log(`Kick times: identical (${kicksCompared} Kicks)`);
if (!differences.size) {
    console.log("No other differences beyond the tolerance.");
} else {
    console.log(`\nDifferences beyond the tolerance (${differences.size} quantities):`);
    for (const [quantity, d] of [...differences].sort((a, b) => a[0].localeCompare(b[0]))) {
        const configs = new Map();
        for (const r of d.runs) {
            const config = r.split(" ").slice(1, 3).join(" ");
            configs.set(config, (configs.get(config) ?? 0) + 1);
        }
        console.log(`- ${quantity}: ${d.frames} times in ${d.runs.size} runs, largest ${d.max.toPrecision(3)}`);
        console.log(`    largest at ${d.at}`);
        console.log(`    runs by config: ${[...configs].map(([config, n]) => `${config} ${n}`).join(", ")}`);
    }
}
process.exit(kickFailures.length ? 1 : 0);

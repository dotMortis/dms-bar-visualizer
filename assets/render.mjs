#!/usr/bin/env node
// Renders the animated SVGs in assets/ (from generate.mjs) to the animated WebPs the README shows.
// A browser playing the SVGs' SMIL animations with their glow filters keeps a CPU core busy for as
// long as the page is open; a WebP costs next to nothing. Run after generate.mjs:
// node assets/render.mjs
//
// Needs Chromium (or Chrome) and ffmpeg. Each SVG is opened in headless Chromium, its animation
// paused and stepped to each frame's time through the DevTools protocol, and screenshotted; ffmpeg
// turns the frames into an animated WebP (full color, lossy: a GIF's 256 colors band the glows and
// weigh several times as much).
//
// A WebP loops one length, so each is one loop of its SVG's main animation (the 6 s beat, the
// layer diagram's 7 s): the slow hue cycle and the wallpaper's drift, on loops of their own, hold
// still, and the layer diagram's wave is retimed to fit its loop three times.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = dirname(fileURLToPath(import.meta.url));
const FPS = 12;
// The WebPs' lossy quality, 0..100.
const QUALITY = Number(process.env.QUALITY ?? 75);

// Each WebP: its SVG, its loop (s), its width (px; the SVG's own size scaled down), and the
// changes to the SVG that make it loop in that time.
const WEBPS = [
    { svg: "hero.svg", loop: 6, width: 960, fit: holdSlow },
    { svg: "bar-anatomy.svg", loop: 6, width: 960, fit: holdSlow },
    { svg: "ring-anatomy.svg", loop: 6, width: 864, fit: holdSlow },
    { svg: "layers.svg", loop: 7, width: 720, fit: svg => svg.replaceAll('dur="2.4s"', 'dur="2.3333s"') },
];

// The hue cycle (24 s) and the wallpaper's drift (18 s, 22 s) slowed a hundredfold: still, over a loop.
function holdSlow(svg) {
    return svg.replace(/dur="(18|22|24)s"/g, (_, s) => `dur="${s * 100}s"`);
}

const BROWSERS = ["chromium", "google-chrome-stable", "google-chrome", "chrome"];
const browser = BROWSERS.find(b => spawnSync(b, ["--version"], { stdio: "ignore" }).status === 0);
if (!browser)
    throw new Error("needs Chromium or Chrome on the PATH: " + BROWSERS.join(", "));

const work = mkdtempSync(join(tmpdir(), "readme-webps-"));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(browser, [
    "--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${join(work, "profile")}`,
    "--hide-scrollbars", "--force-device-scale-factor=1", "--no-first-run", "about:blank",
], { stdio: "ignore" });

try {
    const ws = await connect(port);
    for (const webp of WEBPS)
        await render(ws, webp);
    ws.close();
} finally {
    chrome.kill();
    rmSync(work, { recursive: true, force: true });
}

// The page's DevTools socket, once the browser is up.
async function connect(port) {
    for (let i = 0; i < 100; i++) {
        try {
            const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            const page = pages.find(p => p.type === "page");
            if (page) {
                const ws = new WebSocket(page.webSocketDebuggerUrl);
                await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
                let id = 0;
                const waiting = new Map();
                ws.onmessage = event => {
                    const msg = JSON.parse(event.data);
                    if (!waiting.has(msg.id))
                        return;
                    const { resolve, reject } = waiting.get(msg.id);
                    waiting.delete(msg.id);
                    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
                };
                ws.send_ = (method, params = {}) => new Promise((resolve, reject) => {
                    waiting.set(++id, { resolve, reject });
                    ws.send(JSON.stringify({ id, method, params }));
                });
                return ws;
            }
        } catch {}
        await new Promise(r => setTimeout(r, 100));
    }
    throw new Error("the browser's DevTools didn't come up");
}

// One WebP: the SVG, fitted to its loop, shown at its width; one screenshot per frame; ffmpeg.
async function render(ws, { svg, loop, width, fit }) {
    const source = readFileSync(join(OUT, svg), "utf8");
    const [, w, h] = source.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
    const height = Math.round(h * width / w);
    const page = join(work, "page.html");
    writeFileSync(page, `<!DOCTYPE html><html><body style="margin:0;background:#11111b">${fit(source)
        .replace(/width="\d+" height="\d+"/, `width="${width}" height="${height}"`)}</body></html>`);

    await ws.send_("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await ws.send_("Page.enable");
    await ws.send_("Page.navigate", { url: "file://" + page });
    await waitFor(ws, "document.readyState === 'complete' && !!document.querySelector('svg')");
    await ws.send_("Runtime.evaluate", { expression: "document.fonts.ready", awaitPromise: true });

    const frames = join(work, svg.replace(".svg", ""));
    spawnSync("mkdir", ["-p", frames]);
    const count = Math.round(loop * FPS);
    for (let i = 0; i < count; i++) {
        await ws.send_("Runtime.evaluate", {
            expression: `(() => { const s = document.querySelector('svg'); s.pauseAnimations(); s.setCurrentTime(${i / FPS}); })()`,
        });
        // Two animation frames, so the seek is painted before the shot.
        await ws.send_("Runtime.evaluate", {
            expression: "new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))", awaitPromise: true,
        });
        const shot = await ws.send_("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 } });
        writeFileSync(join(frames, `${String(i).padStart(4, "0")}.png`), Buffer.from(shot.data, "base64"));
    }

    const out = join(OUT, svg.replace(".svg", ".webp"));
    const ffmpeg = spawnSync("ffmpeg", [
        "-y", "-loglevel", "error", "-framerate", String(FPS), "-i", join(frames, "%04d.png"),
        "-c:v", "libwebp_anim", "-lossless", "0", "-quality", String(QUALITY), "-compression_level", "6",
        "-loop", "0", out,
    ], { stdio: "inherit" });
    if (ffmpeg.status !== 0)
        throw new Error(`ffmpeg failed on ${svg}`);
    console.log(`${svg.replace(".svg", ".webp")}: ${Math.round(statSync(out).size / 1024)} KiB, ${count} frames`);
}

async function waitFor(ws, expression) {
    for (let i = 0; i < 100; i++) {
        const { result } = await ws.send_("Runtime.evaluate", { expression, returnByValue: true });
        if (result.value)
            return;
        await new Promise(r => setTimeout(r, 50));
    }
    throw new Error("timed out waiting for: " + expression);
}

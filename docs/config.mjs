// The settings both visualizers share, read from the Bar Visualizer's config.json
// (~/.config/bar-visualizer/config.json): one place to tune them for the bar and the Lock Ring alike
// (ADR 0004). shell.qml adds the bar's geometry and writes the file; the Lock Ring only reads it,
// and runs on these defaults while there is none. Plain ECMAScript that QML, browsers and node all
// load. In docs/, as GitHub Pages serves only that; lock-ring/docs/config.mjs links here.

export const DEFAULTS = {
    intensity: 1.0,       // overall brightness of the effect
    speed: 1.0,           // animation speed multiplier
    kickThreshold: 0.4,   // lower = more kicks detected
    kickDecay: 6.0,       // higher = shorter impact flashes
    kickLowHz: 20,        // frequency range the kick (shockwave + particles) listens to
    kickHighHz: 90,
    kickCooldown: 0.1,    // min seconds between kicks; 0 = no limit
    bassStretch: 1.4,     // >1 spreads bass wider; 1 = linear
};

// config.json, from the environment's XDG_CONFIG_HOME and HOME.
export function configPath(xdgConfigHome, home) {
    return `${xdgConfigHome || `${home}/.config`}/bar-visualizer/config.json`;
}

// The settings in config.json's `text`, over `defaults`: a key that's missing, or of another type
// than its default, gets the default. Keys without a default are dropped. Throws on broken JSON, so
// a half-written file can keep the last good settings.
export function parseConfig(text, defaults = DEFAULTS) {
    const stored = JSON.parse(text);
    const out = {};
    for (const [key, value] of Object.entries(defaults)) {
        const raw = stored?.[key];
        const ok = typeof raw === typeof value && (typeof raw !== "number" || Number.isFinite(raw));
        out[key] = ok ? raw : value;
    }
    return out;
}

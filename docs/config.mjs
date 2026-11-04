// The one config file for both visualizers, ~/.config/bar-visualizer/config.json, and the
// defaults of every key in it (ADR 0004). The Bar Visualizer's settings are at the top level, and
// the Lock Ring reads all of them too; its own are in the lockRing section. shell.qml writes the
// file with these defaults when there is none; the Lock Ring only reads it, and runs on the
// defaults while there is none. Plain ECMAScript that QML, browsers and node all load. In docs/,
// as GitHub Pages serves only that; lock-ring/docs/config.mjs links here.

export const DEFAULTS = {
    // Geometry must match the DMS bar. With a maximized window on a screen's active workspace,
    // DMS drops the spacing and rounding (its "maximize detection"); followMaximize mirrors that.
    barThickness: 40,     // DMS bar body height (from innerPadding/font scale)
    spacing: 4,           // DMS "spacing"
    radius: 12,           // DMS cornerRadius
    followMaximize: true, // match DMS "maximizeDetection"
    // The look and the audio, for the bar and the Lock Ring alike.
    intensity: 1.0,       // overall brightness of the effect
    speed: 1.0,           // animation speed multiplier
    kickThreshold: 0.4,   // lower = more kicks detected
    kickDecay: 6.0,       // higher = shorter impact flashes
    kickLowHz: 20,        // frequency range the kick (shockwave + particles) listens to
    kickHighHz: 90,
    kickCooldown: 0.1,    // min seconds between kicks; 0 = no limit
    bassStretch: 1.4,     // >1 spreads bass wider; 1 = linear
    // The Lock Ring's own.
    lockRing: {
        handWaves: 1.0,   // how far the hands swing with the music and on kicks; 0 = straight
        ringSize: 0.4,    // the widget's default size, as a share of the screen height
    },
};

// config.json, from the environment's XDG_CONFIG_HOME and HOME.
export function configPath(xdgConfigHome, home) {
    return `${configDir(xdgConfigHome, home)}/config.json`;
}

// The directory config.json is in.
export function configDir(xdgConfigHome, home) {
    return `${xdgConfigHome || `${home}/.config`}/bar-visualizer`;
}

const isSection = value => value !== null && typeof value === "object" && !Array.isArray(value);

// `stored` over `defaults`, section by section: a key that's missing, or of another type than its
// default, gets the default. Keys without a default are dropped.
function merge(stored, defaults) {
    const out = {};
    for (const [key, value] of Object.entries(defaults)) {
        const raw = stored?.[key];
        if (isSection(value)) {
            out[key] = merge(isSection(raw) ? raw : {}, value);
            continue;
        }
        const ok = typeof raw === typeof value && (typeof raw !== "number" || Number.isFinite(raw));
        out[key] = ok ? raw : value;
    }
    return out;
}

// The settings in config.json's `text`, over the defaults. Throws on broken JSON, so a
// half-written file can keep the last good settings.
export function parseConfig(text) {
    return merge(JSON.parse(text), DEFAULTS);
}

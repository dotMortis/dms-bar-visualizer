/* The core's C ABI (core/src/c_abi.rs): one Visualizer per visualizer instance.
 *
 * Every call is total: a null Visualizer, a null or short buffer, or settings that aren't UTF-8
 * JSON are ignored. No call unwinds into the caller. visualizer_push_bands, visualizer_advance,
 * visualizer_set_player and visualizer_frame never allocate, nor do visualizer_set_kind,
 * visualizer_set_local_time, visualizer_lock_ring, visualizer_set_position, visualizer_set_bar_size,
 * visualizer_set_ring_size and visualizer_glyphs. visualizer_configure, visualizer_set_track,
 * visualizer_set_lyrics and visualizer_set_letters may.
 *
 * Link against libvisualizer_core.a (or .so) from `cargo build --release` in core/; the static
 * library also needs -lpthread -ldl -lm on Linux. */
#ifndef VISUALIZER_CORE_H
#define VISUALIZER_CORE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* cava's layout: 32 bands from 30 Hz to 14 kHz, bass first. */
#define VISUALIZER_BANDS 32
/* How many Kicks play at once (KICKS in the shaders). */
#define VISUALIZER_KICK_SLOTS 8

/* The Active Player, for visualizer_set_player. */
#define VISUALIZER_PLAYER_NONE 0
#define VISUALIZER_PLAYER_PAUSED 1
#define VISUALIZER_PLAYER_PLAYING 2

/* The Silence cases (GLOSSARY.md), in VisualizerFrame's silence: none (something to hear), no
 * Active Player, the Active Player paused, or playing with every band below 0.02 for 2 s. */
#define VISUALIZER_SILENCE_NONE 0
#define VISUALIZER_SILENCE_NO_PLAYER 1
#define VISUALIZER_SILENCE_PAUSED 2
#define VISUALIZER_SILENCE_SILENT 3

typedef struct Visualizer Visualizer;

/* Everything to draw, as of the last call. Laid out as core/src/lib.rs's Frame: change both. */
typedef struct VisualizerFrame {
    /* The last pushed bands, 0..1, bass first. */
    double bands[VISUALIZER_BANDS];
    /* The averages of bands 0-5, 6-15 and 16-31. */
    double bass, mid, treble;
    /* The Kick level: 1 when a Kick fires, fading at kickDecay per second as display frames pass. */
    double kick;
    /* The animation clock: display seconds times speed, wrapped at 1200 s for 32-bit floats. */
    double time;
    /* The wave phase: runs at speed times 8 bass + 4 mid + 6 Kick level a second; wrapped at 40 pi,
     * where every Ribbon repeats. */
    double flow;
    /* The Kick slots, the last VISUALIZER_KICK_SLOTS Kicks, in any order: each one's age on the
     * animation clock (unwrapped: an empty slot's is time + 100), power (0 = empty) and seed (its
     * number, 1..999 then 0 and round again). */
    double kick_ages[VISUALIZER_KICK_SLOTS];
    double kick_powers[VISUALIZER_KICK_SLOTS];
    double kick_seeds[VISUALIZER_KICK_SLOTS];
    /* The intensity and bassStretch settings, as configured. */
    double intensity, bass_stretch;
    /* The last Kick's power, 0.5..1 by how hard the hit was next to the recent ones; 0 before any. */
    double kick_power;
    /* How many Kicks have fired so far (wrapping): a new one fired when it changes. */
    uint32_t kick_count;
    /* Which Silence case applies: a VISUALIZER_SILENCE_* value. A new Visualizer has no player. */
    uint32_t silence;
    /* Whether anything still moves without sound: a Kick's Shockwave that hasn't played out (3 s
     * on the animation clock, at a speed above 0), or the Kick level above 0.001. A visualizer in
     * Silence that isn't animating may stop drawing. */
    bool animating;
} VisualizerFrame;

/* Which visualizer a Visualizer is, for visualizer_set_kind: the Bar Visualizer (as created), or
 * the Lock Ring, which runs on the bar's settings with its lockRing percentages applied (ADR 0005)
 * and keeps a VisualizerLockRing. */
#define VISUALIZER_KIND_BAR 0
#define VISUALIZER_KIND_LOCK_RING 1

/* How many Hour Points ride the Lock Ring's ribbon: one every 30 degrees from 12 o'clock. */
#define VISUALIZER_HOUR_POINTS 12

/* How the Digital Time takes a Shockwave crossing it (core/src/lock_ring/clock.rs TimeHit): its
 * split copies in lavender, mauve and blue (#b4befe, #cba6f7, #89b4fa), each copy_offsets outward
 * (in font sizes) at copy_opacity, blurred by 0.03 font sizes; the digits' glow (#e6ebff, blur
 * radius 0.35 font sizes) at glow_opacity and glow_scale times their size; and how far the digits
 * flare toward white, 0..1. */
typedef struct VisualizerTimeHit {
    double copy_offsets[3];
    double copy_opacity;
    double glow_opacity;
    double glow_scale;
    double white;
} VisualizerTimeHit;

/* The Lock Ring's state on top of the frame, as of the last call: ring.frag's inputs beyond the
 * frame's, and the Digital Time's hit. Laid out as core/src/lock_ring/frame.rs's LockRingFrame:
 * change both. Hands are hour, minute, second (ring.frag's x, y, z); sizes in dial radii. Kept
 * only while the kind is VISUALIZER_KIND_LOCK_RING. */
typedef struct VisualizerLockRing {
    /* The Lock Ring's motion: its swell (a fraction of the dial radius) and how much music its ribbon
     * shows (0 = only its calm wave in Silence .. 1). ring.frag's swell and presence. */
    double swell, presence;
    /* How brightly every Hand flashes, 0..1 (handFlash). */
    double hand_flash;
    /* Where each Hand points, radians clockwise from 12 o'clock, from the local time alone
     * (handAngle). */
    double hand_angles[3];
    /* handInner, handLength, handAmp, handWidth and handGlow. */
    double hand_inner[3];
    double hand_lengths[3];
    double hand_amplitudes[3];
    double hand_widths[3];
    double hand_glows[3];
    /* How far each Hand's wave has travelled, radians (handPhase). */
    double hand_phases[3];
    /* Each Hand's band (bass, mid, treble) as a share of its own recent peak, 0..1. */
    double hand_levels[3];
    /* The Kick slots as ring.frag takes them (kickAge0/1, kickPower0/1, kickSeed0/1): the frame's,
     * with a played-out or empty slot at age 100, power 0, seed 0. */
    double kick_ages[VISUALIZER_KICK_SLOTS];
    double kick_powers[VISUALIZER_KICK_SLOTS];
    double kick_seeds[VISUALIZER_KICK_SLOTS];
    /* The Hour Points' radii and glows, as ring.frag draws them. */
    double hour_radii[VISUALIZER_HOUR_POINTS];
    double hour_glows[VISUALIZER_HOUR_POINTS];
    /* How brightly a Shockwave's front is crossing the Digital Time, 0..1, and its look. */
    double time_crossing;
    VisualizerTimeHit time_hit;
} VisualizerLockRing;

/* A new Visualizer on the default settings, for visualizer_destroy; null only if it couldn't be
 * made. */
Visualizer *visualizer_create(void);
/* Frees a Visualizer from visualizer_create. */
void visualizer_destroy(Visualizer *visualizer);
/* The settings, as config.json's text: len bytes of UTF-8, no terminator needed. A key that's
 * missing or of the wrong type gets its default; broken JSON keeps the last good settings. May
 * allocate. */
void visualizer_configure(Visualizer *visualizer, const char *json, size_t len);
/* One capture frame: count bands (VISUALIZER_BANDS, else the frame is ignored), 0..1, bass first,
 * and when they came, in real seconds. */
void visualizer_push_bands(Visualizer *visualizer, const double *bands, size_t count, double time);
/* One display frame, dt seconds after the last. */
void visualizer_advance(Visualizer *visualizer, double dt);
/* The Active Player: a VISUALIZER_PLAYER_* value (another is ignored). While it doesn't play,
 * nothing is captured, so the bands read as 0 until the next push. */
void visualizer_set_player(Visualizer *visualizer, uint32_t player);
/* Everything to draw, owned by the Visualizer: valid until the next call on it. Null for a null
 * Visualizer. */
const VisualizerFrame *visualizer_frame(const Visualizer *visualizer);
/* Which visualizer this is: a VISUALIZER_KIND_* value (another is ignored). Configures it as that
 * kind on the settings last configured; the running state carries over. */
void visualizer_set_kind(Visualizer *visualizer, uint32_t kind);
/* The local time of day the Lock Ring's Hands show, in seconds since local midnight: call it on
 * every display frame, before reading the Lock Ring's state. One that isn't a number is ignored;
 * until the first, it is midnight. */
void visualizer_set_local_time(Visualizer *visualizer, double seconds);
/* The Lock Ring's state, owned by the Visualizer: valid until the next call on it. Null for a null
 * Visualizer. */
const VisualizerLockRing *visualizer_lock_ring(const Visualizer *visualizer);

/* ---- Lyric Words (core/src/lyric_words.rs, core/src/c_abi/lyrics.rs) ---------------------------
 * The Active Player's track, timed lyrics and playback position in; the Lyric Words shown out, as
 * glyph instances, one per letter, laid out on the bar. The core loads no fonts: letter advances
 * come in as data. */

/* One of a word's split copies, drawn behind it as a Shockwave crosses it: its color (r, g, b
 * 0..1), how far it's pushed in pixels (outward: on the bar along it, away from its center; on the
 * Lock Ring away from the Dial's center) and its opacity, under the glyph's own. */
typedef struct VisualizerGlyphCopy {
    double color[3];
    double dx, dy;
    double opacity;
} VisualizerGlyphCopy;

/* One letter of a Lyric Word shown. Laid out as core/src/glyph.rs's Glyph: change both. Every
 * field is a double (VISUALIZER_GLYPH_FIELDS of them). */
#define VISUALIZER_GLYPH_FIELDS 40
typedef struct VisualizerGlyph {
    /* The letter: its Unicode code point. */
    double letter;
    /* Which word it belongs to, counting the words shown from 0: a word's glyphs come together, in
     * its letters' order, and every letter of a word has the same look. */
    double word;
    /* Its middle, in pixels, tilted angle degrees clockwise: on the bar from its top left, on the
     * Lock Ring from the Dial's center (y down). */
    double x, y, angle;
    /* The word's size (1 = a settled lead vocal's), scaled around its middle (pivot). */
    double scale, pivot_x, pivot_y;
    /* Its glow's color (r, g, b 0..1): the Ribbon's there, or on the Lock Ring its Ribbon's or
     * Hand's, toward a Shockwave's glow as one crosses it; and its bright core's. */
    double color[3];
    double core[3];
    /* Its opacity, 0..1. */
    double opacity;
    /* Its glow's strength (take at most 1 as its opacity) and how far it spreads beyond the
     * letter (a scale, 1 = the letter's own size). */
    double glow, glow_spread;
    /* How far it has blurred out as its line dissolves, 0..1 of the glow's radius. */
    double blur;
    /* How far toward white it flashes, 0..1 (in core already). */
    double white;
    /* The letters' size in pixels. */
    double em;
    /* The glow's blur radius and the copies' blur, in pixels (it blurs out by blur of the glow's
     * radius as its line dissolves). */
    double glow_radius, copy_blur;
    /* Its split, in the Shockwave's colors. */
    VisualizerGlyphCopy copies[3];
} VisualizerGlyph;

/* Seeds where the Lyric Words land, for repeatable placement (the default is 1). */
void visualizer_set_seed(Visualizer *visualizer, uint32_t seed);
/* The Active Player's track: len bytes of UTF-8, any identity, and its length in seconds (0:
 * unknown). A new identity drops the lyrics and clears the words. */
void visualizer_set_track(Visualizer *visualizer, const char *id, size_t len, double length);
/* The track's lyrics: len bytes of UTF-8 JSON, DMS's lyrics.get result ({found, synced, plain,
 * instrumental}), its lyrics controller's {state, synced}, or the synced lines alone. Only synced
 * lyrics show. The same Lyric Lines again keep the words shown. May allocate. */
void visualizer_set_lyrics(Visualizer *visualizer, const char *json, size_t len);
/* A playback position reading, now: the song time in seconds and the playback rate (1 = normal).
 * It runs on from there at that rate on the display frames' clock while the player plays
 * (visualizer_set_player); a reading more than a second off is a seek, which clears the words. */
void visualizer_set_position(Visualizer *visualizer, double time, double rate);
/* The bar's size in pixels, which the glyphs are laid out on; no glyphs until it's set. */
void visualizer_set_bar_size(Visualizer *visualizer, double width, double height);
/* The Lock Ring's side in pixels (the smaller of its width and height), which its glyphs are laid
 * out on, around the Dial's center; no glyphs on the Lock Ring until it's set. */
void visualizer_set_ring_size(Visualizer *visualizer, double side);
/* The font's measures in ems (shares of its pixel size): len bytes of UTF-8 letters, count
 * advances, one per letter in order, and the line height. Measure the lyrics' letters at any size
 * and divide; a letter not given is 0.5 em wide. May allocate. */
void visualizer_set_letters(Visualizer *visualizer, const char *letters, size_t len, const double *advances,
                            size_t count, double line_height);
/* The Lyric Words shown, as glyph instances, as of the last visualizer_advance: *count of them,
 * owned by the Visualizer, valid until the next call on it. Null (and *count 0) when there are
 * none; null for a null Visualizer or count. */
const VisualizerGlyph *visualizer_glyphs(const Visualizer *visualizer, size_t *count);

#ifdef __cplusplus
}
#endif

#endif

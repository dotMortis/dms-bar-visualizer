/* The core's C ABI (core/src/c_abi.rs): one Visualizer per visualizer instance.
 *
 * Every call is total: a null Visualizer, a null or short buffer, or settings that aren't UTF-8
 * JSON are ignored. No call unwinds into the caller. visualizer_push_bands, visualizer_advance,
 * visualizer_set_player and visualizer_frame never allocate, nor do visualizer_set_kind,
 * visualizer_set_local_time and visualizer_lock_ring.
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
    /* The ring's motion: its swell (a fraction of the dial radius) and how much music its ribbon
     * shows (0 = only its idle wave .. 1). ring.frag's swell and presence. */
    double swell, presence;
    /* How brightly every hand flashes, 0..1 (handFlash). */
    double hand_flash;
    /* Where each hand points, radians clockwise from 12 o'clock, from the local time alone
     * (handAngle). */
    double hand_angles[3];
    /* handInner, handLength, handAmp, handWidth and handGlow. */
    double hand_inner[3];
    double hand_lengths[3];
    double hand_amplitudes[3];
    double hand_widths[3];
    double hand_glows[3];
    /* How far each hand's wave has travelled, radians (handPhase). */
    double hand_phases[3];
    /* Each hand's band (bass, mid, treble) as a share of its own recent peak, 0..1. */
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
 * missing or of the wrong type gets its default; broken JSON keeps the last good settings. The
 * one call that may allocate. */
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

#ifdef __cplusplus
}
#endif

#endif

/* The core's C ABI (core/src/c_abi.rs): one Visualizer per visualizer instance.
 *
 * Every call is total: a null Visualizer, a null or short buffer, or settings that aren't UTF-8
 * JSON are ignored. No call unwinds into the caller. visualizer_push_bands, visualizer_advance and
 * visualizer_frame never allocate.
 *
 * Link against libvisualizer_core.a (or .so) from `cargo build --release` in core/; the static
 * library also needs -lpthread -ldl -lm on Linux. */
#ifndef VISUALIZER_CORE_H
#define VISUALIZER_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* cava's layout: 32 bands from 30 Hz to 14 kHz, bass first. */
#define VISUALIZER_BANDS 32

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
    /* The last Kick's power, 0.5..1 by how hard the hit was next to the recent ones; 0 before any. */
    double kick_power;
    /* How many Kicks have fired so far (wrapping): a new one fired when it changes. */
    uint32_t kick_count;
} VisualizerFrame;

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
/* Everything to draw, owned by the Visualizer: valid until the next call on it. Null for a null
 * Visualizer. */
const VisualizerFrame *visualizer_frame(const Visualizer *visualizer);

#ifdef __cplusplus
}
#endif

#endif

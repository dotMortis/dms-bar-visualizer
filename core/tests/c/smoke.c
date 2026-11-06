/* The C ABI end to end, from C: a Kick fires on a bass hit, lands in its slot and fades as display
 * frames pass; the player and the Silence case.
 * Built and run by tests/c_smoke.rs; prints the frame's layout for it to check against Rust's. */
#include <math.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "visualizer_core.h"

#define CHECK(cond)                                                            \
    do {                                                                       \
        if (!(cond)) {                                                         \
            fprintf(stderr, "%s:%d: failed: %s\n", __FILE__, __LINE__, #cond); \
            return 1;                                                          \
        }                                                                      \
    } while (0)

int main(void) {
    printf("size %zu time %zu flow %zu kick_ages %zu kick_powers %zu kick_seeds %zu intensity %zu "
           "bass_stretch %zu kick_power %zu kick_count %zu silence %zu animating %zu\n",
           sizeof(VisualizerFrame), offsetof(VisualizerFrame, time), offsetof(VisualizerFrame, flow),
           offsetof(VisualizerFrame, kick_ages), offsetof(VisualizerFrame, kick_powers),
           offsetof(VisualizerFrame, kick_seeds), offsetof(VisualizerFrame, intensity),
           offsetof(VisualizerFrame, bass_stretch), offsetof(VisualizerFrame, kick_power),
           offsetof(VisualizerFrame, kick_count), offsetof(VisualizerFrame, silence),
           offsetof(VisualizerFrame, animating));

    /* Nothing to call on: ignored. */
    visualizer_destroy(NULL);
    visualizer_advance(NULL, 1.0);
    CHECK(visualizer_frame(NULL) == NULL);

    Visualizer *v = visualizer_create();
    CHECK(v != NULL);
    const char *settings = "{\"kickThreshold\": 0.4, \"kickDecay\": 6}";
    visualizer_configure(v, settings, strlen(settings));
    CHECK(visualizer_frame(v)->silence == VISUALIZER_SILENCE_NO_PLAYER);
    CHECK(!visualizer_frame(v)->animating);
    visualizer_set_player(v, VISUALIZER_PLAYER_PLAYING);
    CHECK(visualizer_frame(v)->silence == VISUALIZER_SILENCE_NONE);

    /* A second of silence at 60 fps, then a bass hit. */
    double bands[VISUALIZER_BANDS];
    int fired_at = -1;
    for (int n = 0; n < 90 && fired_at < 0; n++) {
        for (int b = 0; b < VISUALIZER_BANDS; b++) bands[b] = (n >= 60 && b >= 1 && b <= 6) ? 0.8 : 0.0;
        visualizer_push_bands(v, bands, VISUALIZER_BANDS, n / 60.0);
        if (visualizer_frame(v)->kick_count == 1) fired_at = n;
        else visualizer_advance(v, 1.0 / 60.0);
    }
    CHECK(fired_at >= 60);

    /* A short frame is no frame. */
    visualizer_push_bands(v, bands, VISUALIZER_BANDS - 1, 5.0);
    const VisualizerFrame *frame = visualizer_frame(v);
    CHECK(frame->kick_count == 1);
    CHECK(frame->kick == 1.0);
    CHECK(frame->kick_power >= 0.5 && frame->kick_power <= 1.0);
    CHECK(fabs(frame->bass - 0.8 * 5.0 / 6.0) < 1e-12);
    /* The first Kick is in slot 1, seed 1, just fired. */
    CHECK(frame->kick_ages[1] == 0.0 && frame->kick_seeds[1] == 1.0);
    CHECK(frame->kick_powers[1] == frame->kick_power);
    CHECK(frame->kick_powers[0] == 0.0);
    CHECK(frame->animating);
    double time = frame->time;

    /* kickDecay 6: half a second on, exp(-3) of the Kick level is left. */
    for (int n = 0; n < 30; n++) visualizer_advance(v, 1.0 / 60.0);
    CHECK(fabs(visualizer_frame(v)->kick - exp(-3.0)) < 1e-9);
    CHECK(fabs(visualizer_frame(v)->time - time - 0.5) < 1e-9);
    CHECK(fabs(visualizer_frame(v)->kick_ages[1] - 0.5) < 1e-9);
    CHECK(visualizer_frame(v)->flow > 0.0);

    /* Paused: nothing captured, the bands read as 0. */
    visualizer_set_player(v, VISUALIZER_PLAYER_PAUSED);
    CHECK(visualizer_frame(v)->silence == VISUALIZER_SILENCE_PAUSED);
    CHECK(visualizer_frame(v)->bass == 0.0);

    visualizer_destroy(v);
    puts("ok");
    return 0;
}

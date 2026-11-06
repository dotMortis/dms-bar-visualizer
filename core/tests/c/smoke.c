/* The C ABI end to end, from C: a Kick fires on a bass hit and fades as display frames pass.
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
    printf("size %zu kick_power %zu kick_count %zu\n", sizeof(VisualizerFrame),
           offsetof(VisualizerFrame, kick_power), offsetof(VisualizerFrame, kick_count));

    /* Nothing to call on: ignored. */
    visualizer_destroy(NULL);
    visualizer_advance(NULL, 1.0);
    CHECK(visualizer_frame(NULL) == NULL);

    Visualizer *v = visualizer_create();
    CHECK(v != NULL);
    const char *settings = "{\"kickThreshold\": 0.4, \"kickDecay\": 6}";
    visualizer_configure(v, settings, strlen(settings));

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

    /* kickDecay 6: half a second on, exp(-3) of the Kick level is left. */
    for (int n = 0; n < 30; n++) visualizer_advance(v, 1.0 / 60.0);
    CHECK(fabs(visualizer_frame(v)->kick - exp(-3.0)) < 1e-9);

    visualizer_destroy(v);
    puts("ok");
    return 0;
}

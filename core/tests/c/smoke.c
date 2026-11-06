/* The C ABI end to end, from C: a Kick fires on a bass hit, lands in its slot and fades as display
 * frames pass; the player and the Silence case; a line of Lyric Words as glyph instances.
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

/* The Lyric Words: a line sung on an 800 x 40 bar, its letters glyph instances. */
static int lyrics(void) {
    printf("glyph size %zu x %zu color %zu core %zu opacity %zu em %zu glow_radius %zu copy_blur %zu copies %zu "
           "copy %zu dx %zu dy %zu\n",
           sizeof(VisualizerGlyph), offsetof(VisualizerGlyph, x), offsetof(VisualizerGlyph, color),
           offsetof(VisualizerGlyph, core), offsetof(VisualizerGlyph, opacity), offsetof(VisualizerGlyph, em),
           offsetof(VisualizerGlyph, glow_radius), offsetof(VisualizerGlyph, copy_blur),
           offsetof(VisualizerGlyph, copies), sizeof(VisualizerGlyphCopy), offsetof(VisualizerGlyphCopy, dx),
           offsetof(VisualizerGlyphCopy, dy));
    CHECK(sizeof(VisualizerGlyph) == VISUALIZER_GLYPH_FIELDS * sizeof(double));

    size_t count = 7;
    CHECK(visualizer_glyphs(NULL, &count) == NULL && count == 0);

    Visualizer *v = visualizer_create();
    visualizer_set_bar_size(v, 800.0, 40.0);
    const double advances[] = {0.5, 0.25};
    visualizer_set_letters(v, "ab", 2, advances, 2, 1.2);
    visualizer_set_seed(v, 3);
    visualizer_set_track(v, "track", 5, 60.0);
    const char *song = "{\"found\": true, \"synced\": [{\"t\": 1, \"e\": 3, \"x\": \"ab ba\"}]}";
    visualizer_set_lyrics(v, song, strlen(song));
    visualizer_set_player(v, VISUALIZER_PLAYER_PLAYING);
    visualizer_set_position(v, 0.0, 1.0);

    /* At 2 s "ab" has popped in; "ba" has only just started, not visible yet. */
    visualizer_advance(v, 2.0);
    const VisualizerGlyph *glyphs = visualizer_glyphs(v, &count);
    CHECK(count == 2 && glyphs != NULL);
    CHECK(glyphs[0].letter == 'a' && glyphs[1].letter == 'b');
    CHECK(glyphs[0].word == 0.0 && glyphs[1].word == 0.0);
    CHECK(glyphs[0].em == 32.0);
    /* Side by side, the letters 16 and 8 px wide, along the middle of a quiet bar. */
    CHECK(fabs(glyphs[1].x - glyphs[0].x - 12.0) < 1e-9);
    CHECK(fabs(glyphs[0].y - 20.0) < 1e-9);
    CHECK(glyphs[0].opacity == 1.0 && glyphs[0].scale == 1.0);
    CHECK(fabs(glyphs[0].glow_radius - 0.45 * 32.0) < 1e-9 && glyphs[0].copies[0].dy == 0.0);
    CHECK(visualizer_frame(v)->animating);

    /* Long after the line: gone. */
    visualizer_advance(v, 10.0);
    CHECK(visualizer_glyphs(v, &count) == NULL && count == 0);
    visualizer_destroy(v);
    return 0;
}

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
    if (lyrics() != 0) return 1;

    /* The Lock Ring kind: its percentages, its Hands on the local time, its state after a Kick. */
    printf("lock_ring size %zu hand_flash %zu hand_angles %zu hand_levels %zu kick_ages %zu hour_radii %zu "
           "hour_glows %zu time_crossing %zu time_hit %zu white %zu\n",
           sizeof(VisualizerLockRing), offsetof(VisualizerLockRing, hand_flash),
           offsetof(VisualizerLockRing, hand_angles), offsetof(VisualizerLockRing, hand_levels),
           offsetof(VisualizerLockRing, kick_ages), offsetof(VisualizerLockRing, hour_radii),
           offsetof(VisualizerLockRing, hour_glows), offsetof(VisualizerLockRing, time_crossing),
           offsetof(VisualizerLockRing, time_hit), offsetof(VisualizerLockRing, time_hit.white));
    CHECK(visualizer_lock_ring(NULL) == NULL);
    Visualizer *ring = visualizer_create();
    const char *ring_settings = "{\"lockRing\": {\"intensityPercent\": 150}}";
    visualizer_configure(ring, ring_settings, strlen(ring_settings));
    visualizer_set_kind(ring, VISUALIZER_KIND_LOCK_RING);
    CHECK(visualizer_frame(ring)->intensity == 1.5);
    visualizer_set_player(ring, VISUALIZER_PLAYER_PLAYING);
    /* 9:00 in the morning: the hour hand at 9 o'clock, the others at 12. */
    visualizer_set_local_time(ring, 9 * 3600.0);
    fired_at = -1;
    for (int n = 0; n < 120; n++) {
        for (int b = 0; b < VISUALIZER_BANDS; b++) bands[b] = (n >= 60 && b >= 1 && b <= 6) ? 0.8 : 0.0;
        visualizer_push_bands(ring, bands, VISUALIZER_BANDS, n / 60.0);
        visualizer_advance(ring, 1.0 / 60.0);
        if (fired_at < 0 && visualizer_frame(ring)->kick_count == 1) fired_at = n;
    }
    CHECK(fired_at >= 60);
    const VisualizerLockRing *state = visualizer_lock_ring(ring);
    CHECK(fabs(state->hand_angles[0] - 1.5 * 3.14159265358979) < 1e-9);
    CHECK(state->hand_angles[1] == 0.0 && state->hand_angles[2] == 0.0);
    CHECK(state->hand_flash > 0.0 && state->hand_flash < 1.0);
    CHECK(state->presence > 0.5 && state->swell > 0.0);
    CHECK(state->kick_powers[1] == visualizer_frame(ring)->kick_power);
    CHECK(state->kick_powers[0] == 0.0 && state->kick_ages[0] == 100.0);
    CHECK(state->hour_glows[0] > state->hour_glows[1]);
    CHECK(state->time_hit.glow_scale >= 1.0);
    /* Its Lyric Words, on a 500 px ring: "ab" around the dial's center, 12 px letters. */
    visualizer_set_ring_size(ring, 500.0);
    visualizer_set_letters(ring, "ab", 2, (const double[]){0.5, 0.25}, 2, 1.2);
    const char *line = "{\"found\": true, \"synced\": [{\"t\": 1, \"e\": 3, \"x\": \"ab\"}]}";
    visualizer_set_track(ring, "track", 5, 60.0);
    visualizer_set_lyrics(ring, line, strlen(line));
    visualizer_set_position(ring, 0.0, 1.0);
    visualizer_advance(ring, 2.0);
    size_t count = 0;
    const VisualizerGlyph *words = visualizer_glyphs(ring, &count);
    CHECK(count == 2 && words != NULL && words[0].letter == 'a' && words[0].em == 12.0);
    double from_center = sqrt(words[0].pivot_x * words[0].pivot_x + words[0].pivot_y * words[0].pivot_y);
    CHECK(from_center > 30.0 && from_center < 250.0);
    visualizer_set_kind(ring, VISUALIZER_KIND_BAR);
    CHECK(visualizer_frame(ring)->intensity == 1.0);
    visualizer_destroy(ring);
    puts("ok");
    return 0;
}

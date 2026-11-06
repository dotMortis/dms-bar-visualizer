// The Bar Visualizer's Ribbons, outside the shader: where each of the three Ribbons sits at any x
// across the bar, from the inputs shaders/viz.frag gets. Lyric Words ride them, so this has to be
// where the shader draws them. Expected heights are worked out by hand from the shader's formula.
// Ported from tests/bar-ribbons.test.mjs.
use visualizer_core::ribbons::*;

fn near(actual: f64, expected: f64, msg: &str) {
    assert!((actual - expected).abs() < 1e-6, "{msg} {actual} != {expected}");
}

const ZERO: [f64; 32] = [0.0; 32];
const HALF: [f64; 32] = [0.5; 32];
const ONE: [f64; 32] = [1.0; 32];

/// An 800 x 40 bar: its center at x = 400, 10 bar-heights to either edge. Silent.
fn quiet() -> RibbonInputs<'static> {
    RibbonInputs {
        width: 800.0,
        height: 40.0,
        bands: &ZERO,
        time: 0.0,
        kick: 0.0,
        treble: 0.0,
        flow: 0.0,
        bass_stretch: 1.0,
        kick_ages: &[],
        kick_powers: &[],
    }
}

fn loud() -> RibbonInputs<'static> {
    RibbonInputs { bands: &ONE, ..quiet() }
}

// Heights are shares of the bar's thickness from its top edge, like qt_TexCoord0.y.
mod the_bars_ribbons {
    use super::*;

    #[test]
    fn lie_flat_along_the_middle_of_the_bar_in_silence() {
        for x in [0.0, 123.0, 400.0, 650.0, 800.0] {
            for strand in 0..3 {
                near(ribbon_height(x, strand, &quiet()), 0.5, &format!("x {x} strand {strand}:"));
            }
        }
    }

    #[test]
    fn start_out_of_the_bars_center_each_at_its_own_phase() {
        near(ribbon_height(400.0, 0, &loud()), 0.5, "");
        near(ribbon_height(400.0, 1, &loud()), 0.137452, "strand 1, 0.5 + 0.42 sin(-2.1):");
        near(ribbon_height(400.0, 2, &loud()), 0.866062, "strand 2, 0.5 + 0.42 sin(-4.2):");
    }

    #[test]
    fn wave_with_the_spectrums_level_the_same_on_both_sides_of_the_center() {
        // Half a bar-height out: 0.5 + 0.42 * amp * sin(0.5 * 2.6), amp = 1.3 * level capped at 1.
        near(ribbon_height(420.0, 0, &loud()), 0.904694, "");
        near(ribbon_height(380.0, 0, &loud()), 0.904694, "");
        near(ribbon_height(420.0, 0, &RibbonInputs { bands: &HALF, ..quiet() }), 0.763052, "");
    }

    #[test]
    fn carry_a_treble_ripple() {
        // wave = sin(1.3) + 0.3 * sin(1.3 * 2.3) * treble
        near(ribbon_height(420.0, 0, &RibbonInputs { treble: 1.0, ..loud() }), 0.923722, "");
    }

    #[test]
    fn travel_outward_as_the_flow_advances() {
        // flow 1: sin(0.5 * 2.6 - 1)
        near(ribbon_height(420.0, 0, &RibbonInputs { flow: 1.0, ..loud() }), 0.5 + 0.42 * 0.295520, "");
    }

    #[test]
    fn spread_the_bass_over_more_of_the_bar_with_bass_stretch() {
        // Bands rising 0..1, halfway to the edge (x = 600, 5 bar-heights out): level 0.5 ** 2.
        let rising: [f64; 32] = std::array::from_fn(|i| i as f64 / 31.0);
        let inputs = RibbonInputs { bands: &rising, bass_stretch: 2.0, ..quiet() };
        near(ribbon_height(600.0, 0, &inputs), 0.557353, "");
    }

    #[test]
    fn surge_where_a_shockwaves_front_passes() {
        // A fresh full-power Shockwave at the center lifts the level there by 0.6, even in silence.
        let fresh = RibbonInputs { kick_ages: &[0.0], kick_powers: &[1.0], ..quiet() };
        near(ribbon_height(400.0, 1, &fresh), 0.282471, "");
        // An empty slot (power 0) does nothing.
        let empty = RibbonInputs { kick_ages: &[0.0], kick_powers: &[0.0], ..quiet() };
        near(ribbon_height(400.0, 1, &empty), 0.5, "");
    }

    #[test]
    fn shake_with_the_bar_on_a_kick() {
        // kick 1 at time 0 shakes the picture up by 0.12 of the bar.
        near(ribbon_height(400.0, 0, &RibbonInputs { kick: 1.0, ..loud() }), 0.38, "");
        near(ribbon_height(400.0, 0, &RibbonInputs { kick: 1.0, ..quiet() }), 0.38, "");
    }
}

// A Ribbon's color, as viz.frag picks it: the palette (lavender, mauve, lavender, pink, lavender,
// blue) cycled by the clock, along the bar, by strand and with the level, deepened (each channel to
// the power 2.35). Lyric Words glow in it. Expected colors are the palette's own, deepened by hand.
mod the_bars_ribbon_colors {
    use super::*;

    fn near_color(actual: [f64; 3], expected: [f64; 3]) {
        for c in 0..3 {
            near(actual[c], expected[c], &format!("channel {c}:"));
        }
    }
    const MAUVE: [f64; 3] = [0.584986, 0.364683, 0.928669];
    const PINK: [f64; 3] = [0.910752, 0.526325, 0.79296];
    const BLUE: [f64; 3] = [0.231974, 0.441256, 0.953633];

    #[test]
    fn cycle_through_the_palette_with_the_clock() {
        // At the center the hue is 0.04 (10 bar-heights times 0.004), plus 0.05 a second.
        near_color(ribbon_color(400.0, 0, &RibbonInputs { time: (1.0 / 6.0 - 0.04) / 0.05, ..quiet() }), MAUVE);
    }

    #[test]
    fn each_strand_a_third_of_the_palette_on() {
        near_color(ribbon_color(400.0, 1, &RibbonInputs { time: (0.5 - 0.04 - 0.33) / 0.05, ..quiet() }), PINK);
    }

    #[test]
    fn shift_along_the_bar_outward_from_the_center() {
        // At the right edge: 20 * 0.004 along it, 0.6 for being at the edge.
        near_color(ribbon_color(800.0, 0, &RibbonInputs { time: (5.0 / 6.0 - 0.68) / 0.05, ..quiet() }), BLUE);
    }

    #[test]
    fn shift_with_the_level() {
        near_color(ribbon_color(400.0, 0, &RibbonInputs { time: (0.5 - 0.04 - 0.2) / 0.05, ..loud() }), PINK);
    }
}

// How brightly a Shockwave's front is crossing a spot on the bar, 0..1: what makes Lyric Words
// flare and split. The fronts ease out from the center to both edges.
mod a_shockwave_crossing_the_bar {
    use super::*;

    fn crossing(x: f64, ages: &[f64], powers: &[f64]) -> f64 {
        shockwave_crossing(x, &RibbonInputs { kick_ages: ages, kick_powers: powers, ..quiet() })
    }

    #[test]
    fn crosses_the_center_at_full_strength_as_it_is_born() {
        near(crossing(400.0, &[0.0], &[1.0]), 1.0, "");
        near(crossing(400.0, &[0.0], &[0.5]), 0.5, "");
    }

    #[test]
    fn hasnt_reached_the_edges_yet_as_it_is_born() {
        near(crossing(800.0, &[0.0], &[1.0]), 0.0, "");
    }

    #[test]
    fn crosses_farther_out_later_fainter_on_both_sides_alike() {
        // The front is 0.9 of the way out after ln(10) / 4.5 s; its strength there is faded to
        // e^(-CROSSING_FADE * that).
        let late = [10f64.ln() / 4.5];
        let strength = (-CROSSING_FADE * 10f64.ln() / 4.5).exp();
        near(crossing(760.0, &late, &[1.0]), strength, "");
        near(crossing(40.0, &late, &[1.0]), strength, "");
        assert!(crossing(760.0, &late, &[1.0]) > 0.5, "still a clear hit near the edges");
    }

    #[test]
    fn lingers_on_a_spot_after_its_front_has_passed_then_lets_go() {
        let after = |age: f64| crossing(400.0, &[age], &[1.0]);
        assert!(after(0.1) > 0.6, "a tenth of a second on: {}", after(0.1));
        assert!(after(0.2) < after(0.1) && after(0.2) > 0.3, "fading: {}", after(0.2));
        assert!(after(3.0) < 1e-4, "long past the center: {}", after(3.0));
    }

    #[test]
    fn takes_the_brightest_of_overlapping_shockwaves_an_empty_slot_does_nothing() {
        near(crossing(400.0, &[0.0, 0.0, 5.0], &[0.6, 0.8, 0.0]), 0.8, "");
        near(crossing(400.0, &[0.0], &[0.0]), 0.0, "");
        near(crossing(400.0, &[], &[]), 0.0, "");
    }
}

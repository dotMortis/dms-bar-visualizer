// The hot path's rules, which every frame() keeps (spec #41): after configure, push_bands, advance
// and frame never allocate, and no input makes any call panic: bad input is clamped or ignored.
mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::*;
use visualizer_core::{Frame, Player, Silence, Visualizer, BANDS, FLOW_WRAP, TIME_WRAP};

/// The system allocator, counting the allocations on threads that asked it to.
struct Counting;

thread_local! {
    static COUNTING: Cell<bool> = const { Cell::new(false) };
    static ALLOCATIONS: Cell<usize> = const { Cell::new(0) };
}

fn note_allocation() {
    let _ = COUNTING.try_with(|on| {
        if on.get() {
            let _ = ALLOCATIONS.try_with(|n| n.set(n.get() + 1));
        }
    });
}

unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        note_allocation();
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        note_allocation();
        System.alloc_zeroed(layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        note_allocation();
        System.realloc(ptr, layout, size)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
}

#[global_allocator]
static ALLOCATOR: Counting = Counting;

/// How many allocations `run` makes on this thread.
fn allocations(run: impl FnOnce()) -> usize {
    ALLOCATIONS.with(|n| n.set(0));
    COUNTING.with(|on| on.set(true));
    run();
    COUNTING.with(|on| on.set(false));
    ALLOCATIONS.with(|n| n.get())
}

#[test]
fn the_count_sees_an_allocation() {
    assert!(allocations(|| drop(std::hint::black_box(vec![1u8; 64]))) > 0);
}

#[test]
fn push_bands_advance_and_frame_never_allocate_after_configure() {
    for (config, settings) in CONFIGS {
        for scenario in scenarios() {
            let frames = &fixture(scenario).frames;
            let mut visualizer = Visualizer::new();
            visualizer.configure(&settings.json());
            let mut sum = 0.0;
            let n = allocations(|| {
                visualizer.set_player(Player::Playing);
                for (i, f) in frames.iter().enumerate() {
                    visualizer.push_bands(&f.values, f.time);
                    visualizer.advance(1.0 / 144.0);
                    if i % 500 == 499 {
                        visualizer.set_player([Player::Paused, Player::None, Player::Playing][i / 500 % 3]);
                    }
                    let frame = std::hint::black_box(visualizer.frame());
                    sum += frame.kick + frame.flow + frame.kick_ages[0] + frame.animating as u8 as f64;
                }
            });
            assert_eq!(n, 0, "{scenario} at {config}: allocations per {} frames (kick sum {sum})", frames.len());
        }
    }
}

#[test]
fn bad_input_doesnt_allocate_either() {
    let mut visualizer = Visualizer::new();
    visualizer.configure("{}");
    let n = allocations(|| {
        visualizer.push_bands(&[f64::NAN; BANDS], 1.0);
        visualizer.push_bands(&[0.5; 7], 2.0);
        visualizer.push_bands(&[0.5; BANDS], f64::NAN);
        visualizer.advance(f64::INFINITY);
        visualizer.set_player(Player::Playing);
        visualizer.set_player(Player::None);
        std::hint::black_box(visualizer.frame());
    });
    assert_eq!(n, 0);
}

/// A frame anything can draw: every number finite, the bands and levels in 0..1.
fn assert_sane(frame: Frame, after: &str) {
    let unit = |x: f64| (0.0..=1.0).contains(&x);
    assert!(frame.bands.iter().all(|&b| unit(b)), "bands after {after}: {:?}", frame.bands);
    for (name, x) in [("bass", frame.bass), ("mid", frame.mid), ("treble", frame.treble), ("kick", frame.kick)] {
        assert!(unit(x), "{name} {x} after {after}");
    }
    assert!(
        frame.kick_power == 0.0 || (0.5..=1.0).contains(&frame.kick_power),
        "kick_power {} after {after}",
        frame.kick_power
    );
    assert!((0.0..TIME_WRAP).contains(&frame.time), "time {} after {after}", frame.time);
    assert!((0.0..FLOW_WRAP).contains(&frame.flow), "flow {} after {after}", frame.flow);
    for slot in 0..frame.kick_ages.len() {
        let (age, power, seed) = (frame.kick_ages[slot], frame.kick_powers[slot], frame.kick_seeds[slot]);
        assert!(age.is_finite() && age >= 0.0, "slot {slot}'s age {age} after {after}");
        assert!(power == 0.0 || (0.5..=1.0).contains(&power), "slot {slot}'s power {power} after {after}");
        assert!(seed.fract() == 0.0 && (0.0..1000.0).contains(&seed), "slot {slot}'s seed {seed} after {after}");
    }
    assert!(frame.intensity.is_finite() && frame.bass_stretch.is_finite(), "settings after {after}");
    // silence and animating are a Silence and a bool by their types.
    let _: (Silence, bool) = (frame.silence, frame.animating);
}

const BAD_SETTINGS: [&str; 12] = [
    "",
    "{",
    "null",
    "[]",
    "\"text\"",
    "{}",
    r#"{"kickThreshold": -1, "kickCooldown": -1, "speed": -1, "kickDecay": -1}"#,
    r#"{"kickThreshold": 1e308, "kickLowHz": 1e308, "kickHighHz": -1e308, "speed": 1e308, "kickDecay": 1e308}"#,
    r#"{"kickLowHz": 14000, "kickHighHz": 20, "kickCooldown": 1e308}"#,
    r#"{"kickThreshold": 0, "kickDecay": 0}"#,
    r#"{"lockRing": {"kickThresholdPercent": -50}, "lyrics": "yes"}"#,
    "\u{0}\u{ffff}",
];

#[test]
fn bad_input_never_panics_and_frame_stays_drawable() {
    let frames = &fixture("steady_house").frames;
    let mut odd_bands = [0.0; BANDS];
    for (i, b) in odd_bands.iter_mut().enumerate() {
        *b = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -3.0, 7.0, 1e-320, 0.5, f64::MAX][i % 8];
    }
    for settings in BAD_SETTINGS {
        let mut visualizer = Visualizer::new();
        visualizer.configure(settings);
        assert_sane(visualizer.frame(), settings);
        for (n, f) in frames.iter().enumerate().take(600) {
            match n % 10 {
                // Wrong band counts.
                1 => visualizer.push_bands(&[], f.time),
                2 => visualizer.push_bands(&f.values[..BANDS - 1], f.time),
                3 => visualizer.push_bands(&[f.values.as_slice(), &[0.5]].concat(), f.time),
                // Bands no capture gives.
                4 => visualizer.push_bands(&odd_bands, f.time),
                // Times that aren't real or run backwards.
                5 => visualizer.push_bands(&f.values, [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -1e308][n / 10 % 4]),
                6 => visualizer.push_bands(&f.values, f.time - 100.0),
                _ => visualizer.push_bands(&f.values, f.time),
            }
            // Negative, huge and not real display frame times.
            let dt = [1.0 / 60.0, -1.0, 0.0, 1e308, f64::INFINITY, f64::NAN, f64::NEG_INFINITY, 1e-320][n % 8];
            visualizer.advance(dt);
            if n % 7 == 0 {
                visualizer.set_player([Player::Playing, Player::Paused, Player::None][n / 7 % 3]);
            }
            assert_sane(visualizer.frame(), &format!("frame {n} at settings {settings:?}, dt {dt}"));
            visualizer.configure(settings);
        }
    }
}

#[test]
fn bad_frames_are_ignored_so_the_kicks_stay_the_same() {
    // A frame with the wrong number of bands, or at no real time, isn't one: around each real
    // frame, the Kicks are those of the real frames alone.
    let frames = &fixture("steady_house").frames;
    let clean = replay(frames, DEFAULTS);
    let mut visualizer = Visualizer::new();
    visualizer.configure(&DEFAULTS.json());
    let mut kicks = Vec::new();
    for f in frames {
        visualizer.push_bands(&f.values[..BANDS - 1], f.time);
        visualizer.push_bands(&[0.9; 64], f.time);
        visualizer.push_bands(&[0.9; BANDS], f64::NAN);
        let count = visualizer.frame().kick_count;
        visualizer.push_bands(&f.values, f.time);
        if visualizer.frame().kick_count != count {
            kicks.push(Kick { time: f.time, power: visualizer.frame().kick_power });
        }
    }
    assert_eq!(kicks, clean);
}

// The same rules hold at the C ABI, whatever pointers and lengths it's handed.
mod c_abi {
    use std::ptr;

    use super::*;
    use visualizer_core::c_abi::*;

    #[test]
    fn push_bands_advance_and_frame_never_allocate_after_configure() {
        let frames = &fixture("zoo1").frames;
        let settings = DEFAULTS.json();
        unsafe {
            let visualizer = visualizer_create();
            visualizer_configure(visualizer, settings.as_ptr(), settings.len());
            let mut sum = 0.0;
            let n = allocations(|| {
                visualizer_set_player(visualizer, 2);
                for f in frames {
                    visualizer_push_bands(visualizer, f.values.as_ptr(), f.values.len(), f.time);
                    visualizer_advance(visualizer, 1.0 / 144.0);
                    sum += std::hint::black_box(*visualizer_frame(visualizer)).kick;
                }
            });
            visualizer_destroy(visualizer);
            assert_eq!(n, 0, "allocations per {} frames (kick sum {sum})", frames.len());
        }
    }

    #[test]
    fn null_pointers_short_buffers_and_broken_text_are_ignored() {
        let bands = [0.5; BANDS];
        unsafe {
            // No Visualizer: every call does nothing, frame gives null.
            visualizer_configure(ptr::null_mut(), "{}".as_ptr(), 2);
            visualizer_push_bands(ptr::null_mut(), bands.as_ptr(), BANDS, 1.0);
            visualizer_advance(ptr::null_mut(), 1.0);
            assert!(visualizer_frame(ptr::null()).is_null());
            visualizer_destroy(ptr::null_mut());

            let visualizer = visualizer_create();
            let before = *visualizer_frame(visualizer);
            let n = allocations(|| {
                visualizer_push_bands(visualizer, ptr::null(), BANDS, 1.0);
                visualizer_push_bands(visualizer, bands.as_ptr(), BANDS - 1, 1.0);
                visualizer_push_bands(visualizer, bands.as_ptr(), 0, 1.0);
                visualizer_advance(visualizer, f64::NAN);
                visualizer_set_player(visualizer, 7);
                visualizer_set_player(ptr::null_mut(), 2);
            });
            assert_eq!(n, 0);
            assert_eq!(*visualizer_frame(visualizer), before);

            // Settings that aren't there or aren't UTF-8 are ignored like broken JSON.
            visualizer_configure(visualizer, ptr::null(), 99);
            visualizer_configure(visualizer, [0xff, 0xfe, b'{', b'}'].as_ptr(), 4);
            visualizer_configure(visualizer, "{\"k".as_ptr(), 3);
            assert_sane(*visualizer_frame(visualizer), "broken settings through the C ABI");
            visualizer_destroy(visualizer);
        }
    }
}

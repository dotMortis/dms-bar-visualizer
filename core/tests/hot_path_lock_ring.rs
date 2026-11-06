// The hot path's rules (spec #41, tests/hot_path.rs) for the Lock Ring kind: after configure and
// set_kind, push_bands, advance, set_local_time, frame and lock_ring never allocate, and no input
// makes any call panic: bad input is clamped or ignored, and the Lock Ring's state stays drawable.
mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;
use std::f64::consts::TAU;

use common::*;
use visualizer_core::lock_ring::PHASE_WRAP;
use visualizer_core::{Kind, LockRingFrame, Player, Visualizer, BANDS};

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

const RING_SETTINGS: &str = r#"{"lockRing": {"intensityPercent": 140, "kickThresholdPercent": 80, "handWaves": 1.3}}"#;

#[test]
fn the_lock_ring_never_allocates_after_configure() {
    for scenario in scenarios() {
        let frames = &fixture(scenario).frames;
        let mut visualizer = Visualizer::new();
        visualizer.configure(RING_SETTINGS);
        visualizer.set_kind(Kind::LockRing);
        let mut sum = 0.0;
        let n = allocations(|| {
            visualizer.set_player(Player::Playing);
            for (i, f) in frames.iter().enumerate() {
                visualizer.set_local_time(43200.0 + i as f64 / 144.0);
                visualizer.push_bands(&f.values, f.time);
                visualizer.advance(1.0 / 144.0);
                if i % 500 == 499 {
                    visualizer.set_player([Player::Paused, Player::None, Player::Playing][i / 500 % 3]);
                }
                let frame = std::hint::black_box(visualizer.frame());
                let ring = std::hint::black_box(visualizer.lock_ring());
                sum += frame.kick + ring.hand_flash + ring.hour_glows[0] + ring.time_crossing;
            }
        });
        assert_eq!(n, 0, "{scenario}: allocations per {} frames (sum {sum})", frames.len());
    }
}

/// A Lock Ring state anything can draw: every number finite and in its range.
fn assert_sane(ring: LockRingFrame, after: &str) {
    let unit = |x: f64| (0.0..=1.0).contains(&x);
    let finite = |xs: &[f64]| xs.iter().all(|x| x.is_finite());
    assert!(ring.swell >= 0.0 && ring.swell <= 0.08 && unit(ring.presence), "motion after {after}: {ring:?}");
    assert!(unit(ring.hand_flash), "hand_flash {} after {after}", ring.hand_flash);
    assert!(ring.hand_angles.iter().all(|a| (0.0..TAU).contains(a)), "angles {:?} after {after}", ring.hand_angles);
    for xs in [ring.hand_inner, ring.hand_lengths, ring.hand_amplitudes, ring.hand_widths] {
        assert!(finite(&xs) && xs.iter().all(|&x| x >= 0.0), "a hand's shape {xs:?} after {after}");
    }
    assert!(ring.hand_glows.iter().chain(&ring.hand_levels).all(|&x| unit(x)), "hand levels after {after}");
    assert!(ring.hand_phases.iter().all(|p| (0.0..PHASE_WRAP).contains(p)), "phases {:?} after {after}", ring.hand_phases);
    assert!(finite(&ring.kick_ages) && finite(&ring.kick_seeds), "slots after {after}");
    assert!(ring.kick_powers.iter().all(|&p| p == 0.0 || (0.5..=1.0).contains(&p)), "powers after {after}");
    assert!(finite(&ring.hour_radii) && ring.hour_glows.iter().all(|&g| g.is_finite() && g >= 0.0), "hour points after {after}");
    assert!(unit(ring.time_crossing), "time_crossing {} after {after}", ring.time_crossing);
    let hit = ring.time_hit;
    assert!(finite(&hit.copy_offsets) && unit(hit.copy_opacity) && unit(hit.glow_opacity) && unit(hit.white), "{hit:?}");
}

const BAD_SETTINGS: [&str; 8] = [
    "",
    "{",
    "{}",
    r#"{"lockRing": null}"#,
    r#"{"lockRing": {"handWaves": -1, "intensityPercent": -50, "kickThresholdPercent": 1e308}}"#,
    r#"{"lockRing": {"handWaves": 1e308, "kickLowHzPercent": 1e308, "kickHighHzPercent": -5, "kickCooldownPercent": 1e308}}"#,
    r#"{"speed": 1e308, "kickDecay": 1e308, "bassStretch": 1e308, "intensity": 1e308, "lockRing": {"intensityPercent": 300}}"#,
    r#"{"speed": 0, "kickDecay": 0, "bassStretch": -3, "kickCooldown": 1e308}"#,
];

#[test]
fn bad_input_never_panics_and_the_lock_ring_stays_drawable() {
    let frames = &fixture("dnb_808").frames;
    let mut odd_bands = [0.0; BANDS];
    for (i, b) in odd_bands.iter_mut().enumerate() {
        *b = [f64::NAN, f64::INFINITY, f64::NEG_INFINITY, -3.0, 7.0, 1e-320, 0.5, f64::MAX][i % 8];
    }
    let times = [43200.0, -1.0, 1e308, f64::NAN, f64::INFINITY, -1e308, 86400.0, 1e-320];
    for settings in BAD_SETTINGS {
        let mut visualizer = Visualizer::new();
        visualizer.set_kind(Kind::LockRing);
        visualizer.configure(settings);
        assert_sane(visualizer.lock_ring(), settings);
        for (n, f) in frames.iter().enumerate().take(600) {
            match n % 5 {
                1 => visualizer.push_bands(&odd_bands, f.time),
                2 => visualizer.push_bands(&f.values, [f64::NAN, -1e308][n / 5 % 2]),
                _ => visualizer.push_bands(&f.values, f.time),
            }
            visualizer.set_local_time(times[n % times.len()]);
            let dt = [1.0 / 60.0, -1.0, 0.0, 1e308, f64::INFINITY, f64::NAN, f64::NEG_INFINITY, 1e-320][n % 8];
            visualizer.advance(dt);
            if n % 7 == 0 {
                visualizer.set_player([Player::Playing, Player::Paused, Player::None][n / 7 % 3]);
            }
            if n % 11 == 0 {
                visualizer.set_kind([Kind::Bar, Kind::LockRing][n / 11 % 2]);
            }
            assert_sane(visualizer.lock_ring(), &format!("frame {n} at settings {settings:?}, dt {dt}"));
            visualizer.configure(settings);
        }
    }
}

// The same rules at the C ABI.
mod c_abi {
    use std::ptr;

    use super::*;
    use visualizer_core::c_abi::*;

    #[test]
    fn the_lock_ring_never_allocates_after_configure() {
        let frames = &fixture("zoo2").frames;
        unsafe {
            let visualizer = visualizer_create();
            visualizer_configure(visualizer, RING_SETTINGS.as_ptr(), RING_SETTINGS.len());
            visualizer_set_kind(visualizer, 1);
            let mut sum = 0.0;
            let n = allocations(|| {
                visualizer_set_player(visualizer, 2);
                for (i, f) in frames.iter().enumerate() {
                    visualizer_set_local_time(visualizer, 3600.0 + i as f64 / 60.0);
                    visualizer_push_bands(visualizer, f.values.as_ptr(), f.values.len(), f.time);
                    visualizer_advance(visualizer, 1.0 / 60.0);
                    sum += (*visualizer_frame(visualizer)).kick + (*visualizer_lock_ring(visualizer)).hand_flash;
                }
            });
            assert_eq!(n, 0, "allocations per {} frames (sum {sum})", frames.len());
            visualizer_destroy(visualizer);
        }
    }

    #[test]
    fn null_pointers_and_unknown_kinds_are_ignored() {
        unsafe {
            visualizer_set_kind(ptr::null_mut(), 1);
            visualizer_set_local_time(ptr::null_mut(), 3600.0);
            assert!(visualizer_lock_ring(ptr::null()).is_null());

            let visualizer = visualizer_create();
            let settings = r#"{"lockRing": {"intensityPercent": 200}}"#;
            visualizer_configure(visualizer, settings.as_ptr(), settings.len());
            let n = allocations(|| {
                visualizer_set_kind(visualizer, 2);
                visualizer_set_kind(visualizer, u32::MAX);
                visualizer_set_local_time(visualizer, f64::NAN);
            });
            assert_eq!(n, 0);
            assert_eq!((*visualizer_frame(visualizer)).intensity, 1.0, "still the bar");
            visualizer_set_kind(visualizer, 1);
            assert_eq!((*visualizer_frame(visualizer)).intensity, 2.0, "the Lock Ring");
            visualizer_set_local_time(visualizer, 3.0 * 3600.0);
            assert_eq!((*visualizer_lock_ring(visualizer)).hand_angles, [90.0 * std::f64::consts::PI / 180.0, 0.0, 0.0]);
            visualizer_set_kind(visualizer, 0);
            assert_eq!((*visualizer_frame(visualizer)).intensity, 1.0, "the bar again");
            visualizer_destroy(visualizer);
        }
    }
}

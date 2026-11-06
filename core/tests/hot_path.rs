// The hot path's rules, which every frame() keeps (spec #41): after configure, push_bands, advance
// and frame never allocate, and no input makes any call panic: bad input is clamped or ignored.
mod common;

use std::alloc::{GlobalAlloc, Layout, System};
use std::cell::Cell;

use common::*;
use visualizer_core::{Frame, Kind, Player, Silence, Visualizer, BANDS, FLOW_WRAP, TIME_WRAP};

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

/// The shared demo song (harness/lyrics.json, docs/demo-lyrics.mjs's DEMO_LINES), and a line of 60
/// words that pile up, as DMS's lyrics.get reply.
fn song() -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../harness/lyrics.json");
    let mut lines: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let words: Vec<String> = (0..60).map(|i| format!("word{i}")).collect();
    lines.as_array_mut().unwrap().push(serde_json::json!({ "t": 30, "e": 40, "x": words.join(" ") }));
    serde_json::json!({ "found": true, "synced": lines }).to_string()
}

/// A Visualizer showing the song's Lyric Words on an 800 x 40 bar.
fn singing(settings: &str) -> Visualizer {
    let mut visualizer = Visualizer::new();
    visualizer.configure(settings);
    visualizer.set_bar_size(800.0, 40.0);
    visualizer.set_letters("abcdefghijklmnopqrstuvwxyz", &[0.55; 26], 1.2);
    visualizer.set_seed(7);
    visualizer.set_track("song", 45.0);
    visualizer.set_lyrics(&song());
    visualizer
}

#[test]
fn the_lyric_words_and_their_glyphs_never_allocate_after_set_lyrics() {
    let frames = &fixture("steady_house").frames;
    let mut visualizer = singing(&DEFAULTS.json());
    let (mut words, mut glyphs) = (0, 0);
    let n = allocations(|| {
        visualizer.set_player(Player::Playing);
        visualizer.set_position(0.0, 1.0);
        for (i, f) in frames.iter().enumerate() {
            visualizer.push_bands(&f.values, f.time);
            visualizer.advance(1.0 / 60.0);
            // Readings now and then, some of them seeks, and a pause.
            match i % 600 {
                100 => visualizer.set_position(visualizer.song_position() + 0.05, 1.0),
                300 => visualizer.set_position(38.0, 1.0),
                400 => visualizer.set_player(Player::Paused),
                420 => visualizer.set_player(Player::Playing),
                599 => visualizer.set_position(0.5, 1.25),
                _ => {}
            }
            words = words.max(visualizer.lyric_words().len());
            glyphs = glyphs.max(std::hint::black_box(visualizer.glyphs()).len());
        }
    });
    assert_eq!(n, 0, "allocations over {} frames", frames.len());
    assert!(words >= 60 && glyphs > 300, "the words did show: {words} words, {glyphs} glyphs at most");
}

/// A Lock Ring showing the song's Lyric Words on a 600 px ring.
fn singing_ring(settings: &str) -> Visualizer {
    let mut visualizer = singing(settings);
    visualizer.set_kind(Kind::LockRing);
    visualizer.set_ring_size(600.0);
    visualizer
}

#[test]
fn the_lock_rings_lyric_words_and_their_glyphs_never_allocate_after_set_lyrics() {
    let frames = &fixture("steady_house").frames;
    let mut visualizer = singing_ring(&DEFAULTS.json());
    let (mut words, mut glyphs, mut on_hands) = (0, 0, 0);
    let n = allocations(|| {
        visualizer.set_player(Player::Playing);
        visualizer.set_position(0.0, 1.0);
        for (i, f) in frames.iter().enumerate() {
            visualizer.set_local_time(36000.0 + i as f64 / 60.0);
            visualizer.set_ring_size(600.0 + (i % 7) as f64);
            visualizer.push_bands(&f.values, f.time);
            visualizer.advance(1.0 / 60.0);
            match i % 600 {
                100 => visualizer.set_position(visualizer.song_position() + 0.05, 1.0),
                300 => visualizer.set_position(38.0, 1.0),
                400 => visualizer.set_player(Player::Paused),
                420 => visualizer.set_player(Player::Playing),
                599 => visualizer.set_position(0.5, 1.25),
                _ => {}
            }
            words = words.max(visualizer.lyric_words().len());
            let shown = std::hint::black_box(visualizer.glyphs());
            glyphs = glyphs.max(shown.len());
            on_hands += visualizer
                .lyric_words()
                .iter()
                .filter(|w| matches!(w.spot, visualizer_core::Spot::Hand { .. }))
                .count();
        }
    });
    assert_eq!(n, 0, "allocations over {} frames", frames.len());
    assert!(words >= 60 && glyphs > 300 && on_hands > 0, "the words did show: {words} words, {glyphs} glyphs");
}

#[test]
fn the_same_lyrics_again_dont_allocate_per_frame_either() {
    let mut visualizer = singing("{}");
    visualizer.set_player(Player::Playing);
    visualizer.set_position(13.5, 1.0);
    visualizer.advance(0.0);
    visualizer.set_lyrics(&song());
    visualizer.set_track("song", 45.0);
    let n = allocations(|| {
        for _ in 0..300 {
            visualizer.advance(1.0 / 60.0);
        }
    });
    assert_eq!(n, 0);
    assert!(!visualizer.glyphs().is_empty());
}

#[test]
fn set_kind_never_allocates_even_with_lyrics_loaded() {
    let frames = &fixture("steady_house").frames;
    let mut visualizer = singing(&DEFAULTS.json());
    visualizer.set_ring_size(600.0);
    let (mut bar, mut ring) = (0, 0);
    let n = allocations(|| {
        visualizer.set_player(Player::Playing);
        visualizer.set_position(0.0, 1.0);
        for (i, f) in frames.iter().enumerate() {
            // Switch kind every 50 frames, the words shown at the time cleared each time.
            if i % 50 == 0 {
                visualizer.set_kind(if i % 100 == 0 { Kind::LockRing } else { Kind::Bar });
            }
            visualizer.set_local_time(36000.0 + i as f64 / 60.0);
            visualizer.push_bands(&f.values, f.time);
            visualizer.advance(1.0 / 60.0);
            let shown = std::hint::black_box(visualizer.glyphs()).len();
            if i % 100 < 50 {
                ring = ring.max(shown);
            } else {
                bar = bar.max(shown);
            }
        }
    });
    assert_eq!(n, 0, "allocations over {} frames", frames.len());
    assert!(bar > 0 && ring > 0, "the words did show in both kinds: {bar} bar, {ring} ring glyphs at most");
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

/// Glyphs anything can draw: every number finite, the opacities in 0..1, each glyph a letter of a
/// word shown.
fn assert_drawable(visualizer: &Visualizer, after: &str) {
    let words = visualizer.lyric_words().len();
    for g in visualizer.glyphs() {
        let copies = g.copies.iter().flat_map(|c| [c.color[0], c.color[1], c.color[2], c.dx, c.dy, c.opacity]);
        let numbers = [
            g.x,
            g.y,
            g.angle,
            g.scale,
            g.pivot_x,
            g.pivot_y,
            g.glow,
            g.glow_spread,
            g.blur,
            g.white,
            g.em,
            g.glow_radius,
            g.copy_blur,
        ];
        assert!(
            numbers.into_iter().chain(g.color).chain(g.core).chain(copies).all(f64::is_finite),
            "{g:?} after {after}"
        );
        assert!(g.opacity > 0.0 && g.opacity <= 1.0, "{g:?} after {after}");
        assert!(char::from_u32(g.letter as u32).is_some() && (g.word as usize) < words, "{g:?} after {after}");
    }
}

#[test]
fn bad_lyrics_input_never_panics_and_the_glyphs_stay_drawable() {
    let lyrics = [
        "",
        "{",
        "null",
        "[1, null, {}, {\"t\": -1, \"x\": \"before the start\"}, {\"t\": 1, \"x\": 5}]",
        r#"{"synced": [{"t": 1e308, "e": -1e308, "x": "far away", "w": [{"t": 1e308, "x": "far "}, {"t": "2", "x": "away"}]}]}"#,
        r#"[{"t": 0, "x": "   "}, {"t": 0, "x": "", "group": 0.5}, {"t": 0, "e": 0, "x": "zero"}, {"t": 0, "x": "same start"}]"#,
        r#"[{"t": 1, "x": "a\u0000b \u{feff} ✨ 🎶 ünïcödé", "parts": "no"}, {"t": 2, "x": "x", "w": [{"t": 2, "e": 1, "x": "x"}]}]"#,
        r#"[{"t": 1, "e": 2, "parts": [null, {"t": 1, "x": "part"}], "x": "ignored"}]"#,
    ];
    let frames = &fixture("steady_house").frames;
    for (text, kind) in lyrics.iter().flat_map(|t| [(t, Kind::Bar), (t, Kind::LockRing)]) {
        for (size, letters) in
            [((800.0, 40.0), 0.5), ((f64::NAN, -3.0), f64::NAN), ((1e308, 1e308), 1e308), ((1.0, 0.1), 0.0)]
        {
            let mut visualizer = Visualizer::new();
            visualizer.set_kind(kind);
            visualizer.set_bar_size(size.0, size.1);
            visualizer.set_ring_size(size.0.max(size.1));
            visualizer.set_local_time(size.1);
            visualizer.set_letters("ab✨", &[letters, -1.0, f64::INFINITY], letters);
            visualizer.set_track("t", [300.0, f64::NAN, -5.0, 1e308][text.len() % 4]);
            visualizer.set_lyrics(text);
            visualizer.set_player(Player::Playing);
            for (n, f) in frames.iter().enumerate().take(400) {
                visualizer.push_bands(&f.values, f.time);
                visualizer.advance([1.0 / 60.0, 0.5, f64::NAN, 1e308][n % 4]);
                if n % 50 == 0 {
                    let time = [0.0, f64::NAN, 1e308, -1e308, 1.5][n / 50 % 5];
                    let rate = [1.0, f64::INFINITY, -2.0, 0.0, 1e308][n / 50 % 5];
                    visualizer.set_position(time, rate);
                }
                assert_drawable(&visualizer, &format!("frame {n} of {text:?} on {size:?} ({kind:?})"));
                for w in visualizer.lyric_words() {
                    let _ = (visualizer.word_text(w), visualizer.word_row(w));
                }
            }
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
    fn the_lyric_words_never_allocate_after_set_lyrics() {
        let frames = &fixture("zoo1").frames;
        let (song, letters) = (super::song(), "abcdefghijklmnopqrstuvwxyz");
        unsafe {
            let visualizer = visualizer_create();
            visualizer_set_letters(visualizer, letters.as_ptr(), letters.len(), [0.5; 26].as_ptr(), 26, 1.2);
            visualizer_set_track(visualizer, "song".as_ptr(), 4, 45.0);
            visualizer_set_lyrics(visualizer, song.as_ptr(), song.len());
            let mut most = 0;
            let n = allocations(|| {
                visualizer_set_bar_size(visualizer, 800.0, 40.0);
                visualizer_set_player(visualizer, 2);
                visualizer_set_position(visualizer, 28.0, 1.0);
                for f in frames {
                    visualizer_push_bands(visualizer, f.values.as_ptr(), f.values.len(), f.time);
                    visualizer_advance(visualizer, 1.0 / 60.0);
                    let mut count = 0;
                    std::hint::black_box(visualizer_glyphs(visualizer, &mut count));
                    most = most.max(count);
                }
            });
            visualizer_destroy(visualizer);
            assert_eq!(n, 0, "allocations per {} frames", frames.len());
            assert!(most > 100, "the words did show: {most} glyphs");
        }
    }

    #[test]
    fn the_lock_rings_lyric_words_never_allocate_after_set_lyrics() {
        let frames = &fixture("zoo1").frames;
        let (song, letters) = (super::song(), "abcdefghijklmnopqrstuvwxyz");
        unsafe {
            let visualizer = visualizer_create();
            visualizer_set_kind(visualizer, Kind::LockRing as u32);
            visualizer_set_letters(visualizer, letters.as_ptr(), letters.len(), [0.5; 26].as_ptr(), 26, 1.2);
            visualizer_set_track(visualizer, "song".as_ptr(), 4, 45.0);
            visualizer_set_lyrics(visualizer, song.as_ptr(), song.len());
            let mut most = 0;
            let n = allocations(|| {
                visualizer_set_ring_size(visualizer, 600.0);
                visualizer_set_player(visualizer, 2);
                visualizer_set_position(visualizer, 28.0, 1.0);
                for (i, f) in frames.iter().enumerate() {
                    visualizer_set_local_time(visualizer, 36000.0 + i as f64 / 60.0);
                    visualizer_push_bands(visualizer, f.values.as_ptr(), f.values.len(), f.time);
                    visualizer_advance(visualizer, 1.0 / 60.0);
                    let mut count = 0;
                    std::hint::black_box(visualizer_glyphs(visualizer, &mut count));
                    most = most.max(count);
                }
            });
            visualizer_destroy(visualizer);
            assert_eq!(n, 0, "allocations per {} frames", frames.len());
            assert!(most > 100, "the words did show: {most} glyphs");
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

// In Silence the Lock Ring keeps breathing, but slowly (#56, lock-ring/pace.mjs and LockAudio.qml,
// tests/lock-pace.test.mjs ported): once the music has played out on the ring, its lock_ring()
// says `slow`, and the host steps it at SILENCE_FPS instead of every frame. While slow, frame() is
// the music at rest (no bands, no Kicks, the wave's phase held), so nothing the capture still does
// below the Silence threshold redraws it between slow frames; the clock and the Hands run on. The
// first sound brings every frame back at once.
use visualizer_core::lock_ring::{ribbon_radius, RibbonAt, IDLE_REACH, SILENCE_FPS};
use visualizer_core::{Kind, Player, Silence, Visualizer, BANDS, SILENCE_HOLD};

const DT: f64 = 1.0 / 60.0;

fn loud() -> [f64; BANDS] {
    std::array::from_fn(|i| if i < 16 { 0.8 } else { 0.4 })
}

/// A Lock Ring that has played loud music for 3 s, each frame's bands pushed `at` its time.
fn after_music() -> (Visualizer, f64) {
    let mut v = Visualizer::new();
    v.set_kind(Kind::LockRing);
    v.set_player(Player::Playing);
    let mut t = 0.0;
    while t < 3.0 {
        t += DT;
        v.push_bands(&loud(), t);
        v.advance(DT);
    }
    (v, t)
}

/// Runs display frames (with quiet capture frames while `capture`) until the ring draws slowly;
/// the seconds that took, or None within `limit`.
fn until_slow(v: &mut Visualizer, t: &mut f64, capture: bool, limit: f64) -> Option<f64> {
    let start = *t;
    while *t - start < limit {
        *t += DT;
        if capture {
            v.push_bands(&[0.0; BANDS], *t);
        }
        v.advance(DT);
        if v.lock_ring().slow {
            return Some(*t - start);
        }
    }
    None
}

#[test]
fn with_something_to_hear_it_draws_every_frame_however_calm_the_ring_is() {
    let mut v = Visualizer::new();
    v.set_kind(Kind::LockRing);
    v.set_player(Player::Playing);
    let mut quiet_but_heard = [0.0; BANDS];
    quiet_but_heard[20] = 0.05;
    for i in 1..600 {
        v.push_bands(&quiet_but_heard, i as f64 * DT);
        v.advance(DT);
        assert_eq!(v.frame().silence, Silence::None);
        assert!(!v.lock_ring().slow, "slow at frame {i} with something to hear");
    }
}

#[test]
fn in_each_silence_case_once_the_ring_is_at_rest_it_draws_slowly() {
    for (player, silence) in [(Player::None, Silence::NoPlayer), (Player::Paused, Silence::Paused)] {
        let mut v = Visualizer::new();
        v.set_kind(Kind::LockRing);
        v.set_player(player);
        v.advance(DT);
        assert_eq!(v.frame().silence, silence);
        assert!(v.lock_ring().slow, "{silence:?}");
    }
    let mut v = Visualizer::new();
    v.set_kind(Kind::LockRing);
    v.set_player(Player::Playing);
    let mut t = 0.0;
    let slow = until_slow(&mut v, &mut t, true, SILENCE_HOLD + 1.0).expect("slow once silent");
    assert_eq!(v.frame().silence, Silence::Silent);
    assert!(slow >= SILENCE_HOLD - DT, "slow after {slow} s, before the output counted as silent");
}

#[test]
fn when_the_music_stops_it_is_slow_within_2_s_and_not_before_the_ribbons_have_faded() {
    for stop in [Player::Paused, Player::None] {
        let (mut v, mut t) = after_music();
        v.set_player(stop);
        assert!(!v.lock_ring().slow, "{stop:?}: still playing out at once");
        let slow = until_slow(&mut v, &mut t, false, 4.0).expect("slow");
        assert!((0.5..=2.0).contains(&slow), "{stop:?}: slow after {slow} s");
    }
}

#[test]
fn a_shockwave_on_its_way_holds_it() {
    let (mut v, mut t) = after_music();
    assert!(v.frame().kick_count > 0, "the music fired Kicks");
    let f = v.frame();
    let ages = f.kick_ages.iter().zip(f.kick_powers).filter(|p| p.1 > 0.0).map(|p| *p.0);
    let youngest = ages.fold(f64::INFINITY, f64::min);
    v.set_player(Player::Paused);
    let slow = until_slow(&mut v, &mut t, false, 5.0).expect("slow");
    assert!(youngest + slow >= visualizer_core::PLAYED_OUT - DT, "slow {slow} s on, with a Shockwave {youngest} s old");
}

#[test]
fn while_slow_the_frame_is_the_music_at_rest_and_the_clock_and_hands_run_on() {
    let (mut v, mut t) = after_music();
    v.set_player(Player::Playing);
    until_slow(&mut v, &mut t, true, 10.0).expect("slow once silent");
    let flow = v.frame().flow;
    let mut nearly_silent = [0.0; BANDS];
    nearly_silent[3] = 0.015;
    for i in 0..100 {
        let before = v.frame().time;
        v.set_local_time(36000.0 + i as f64 / 10.0);
        t += 0.1;
        v.push_bands(&nearly_silent, t);
        v.advance(0.1);
        let (f, r) = (v.frame(), v.lock_ring());
        assert!(r.slow);
        assert_eq!(f.bands, [0.0; BANDS], "no bands");
        assert_eq!((f.bass, f.mid, f.treble, f.kick), (0.0, 0.0, 0.0, 0.0));
        assert_eq!(f.flow, flow, "the wave's phase held");
        assert!(f.kick_powers.iter().chain(&r.kick_powers).all(|&p| p == 0.0), "no Kicks");
        assert!(f.time > before, "the clock runs on");
        let second_hand = r.hand_angles[2];
        assert!((second_hand - (i as f64 / 10.0 % 60.0) * std::f64::consts::TAU / 60.0).abs() < 1e-9);
    }
}

#[test]
fn the_first_sound_brings_every_frame_back_at_once() {
    let (mut v, mut t) = after_music();
    v.set_player(Player::Playing);
    until_slow(&mut v, &mut t, true, 10.0).expect("slow once silent");
    t += DT;
    v.push_bands(&loud(), t);
    assert!(!v.lock_ring().slow, "slow after a sound");
    assert_eq!(v.frame().bands, loud(), "the frame has the sound");
    let paused = {
        let (mut v, mut t) = after_music();
        v.set_player(Player::Paused);
        until_slow(&mut v, &mut t, false, 4.0).expect("slow");
        v.set_player(Player::Playing);
        v
    };
    assert!(!paused.lock_ring().slow, "slow after playing again");
}

/// The Lyric Words: a song whose words come every half second from 0.5 s to 60 s.
fn sung(v: &mut Visualizer) {
    let lines: Vec<String> =
        (0..20).map(|i| format!(r#"{{"t": {}, "e": {}, "x": "a b c d e f"}}"#, 3 * i, 3 * i + 3)).collect();
    v.set_track("song", 60.0);
    v.set_lyrics(&format!(r#"{{"found": true, "synced": [{}]}}"#, lines.join(",")));
    v.set_position(0.0, 1.0);
}

#[test]
fn lyric_words_moving_hold_it_but_not_once_the_song_stops() {
    let mut v = Visualizer::new();
    v.set_kind(Kind::LockRing);
    v.set_player(Player::Playing);
    sung(&mut v);
    // Silent output, the song playing on: its words keep popping in, so it never goes slow for
    // long; each pop-in brings every frame back.
    let mut t = 0.0;
    let mut fast_while_silent = 0;
    for _ in 0..600 {
        t += DT;
        v.push_bands(&[0.0; BANDS], t);
        v.advance(DT);
        if v.frame().silence == Silence::Silent && !v.lock_ring().slow {
            fast_while_silent += 1;
        }
        let moving = v.lyric_words().iter().any(|w| w.pop_in < 1.0 || w.dissolve > 0.0);
        if moving {
            assert!(!v.lock_ring().slow, "slow at {t} s with a word moving");
        }
    }
    assert!(fast_while_silent > 0, "the words held it while silent");
    // Paused, the words stand still with the song: shown ones don't hold it.
    v.set_player(Player::Paused);
    v.advance(DT);
    assert!(v.lock_ring().slow, "words standing still held it");
}

#[test]
fn the_bar_never_draws_slowly() {
    let mut v = Visualizer::new();
    v.set_player(Player::Paused);
    for _ in 0..300 {
        v.advance(DT);
    }
    assert!(!v.lock_ring().slow);
}

#[test]
fn in_silence_it_draws_at_a_low_fixed_frame_rate() {
    assert!(SILENCE_FPS.fract() == 0.0 && SILENCE_FPS > 0.0 && SILENCE_FPS <= 15.0, "{SILENCE_FPS} fps");
}

#[test]
fn the_c_header_gives_the_same_rate() {
    let header = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/include/visualizer_core.h")).unwrap();
    let define = header.lines().find_map(|l| l.strip_prefix("#define VISUALIZER_SILENCE_FPS ")).expect("the define");
    assert_eq!(define.trim().parse::<f64>().unwrap(), SILENCE_FPS);
}

#[test]
fn at_that_rate_the_calm_wave_still_moves_every_frame_in_steps_too_small_to_see_as_jumps() {
    let at = |angle: f64, time: f64| ribbon_radius(angle, &RibbonAt { time, ..RibbonAt::default() });
    for time in [0.0, 7.3, 600.0] {
        for angle in [0.0, 45.0, 180.0, 290.0] {
            let step = (at(angle, time + 1.0 / SILENCE_FPS) - at(angle, time)).abs();
            assert!(step < IDLE_REACH * 0.2, "{step} at {angle} deg, {time} s");
        }
    }
    assert!([0.0, 45.0, 180.0, 290.0].iter().any(|&a| at(a, 7.3 + 1.0 / SILENCE_FPS) != at(a, 7.3)), "it moved");
}

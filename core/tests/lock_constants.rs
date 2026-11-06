// The Lock Ring's numbers live once, in the core (src/lock_ring). The shader can't import them, so
// lock-ring/shaders/ring.frag repeats them; these checks keep its copies on the core's, as
// tests/lock-constants.test.mjs did for docs/lock-ring/*.mjs (v0.10.0). Its checks of the Lyric
// Words' numbers belong to the Lock Ring's Lyric Words; those of LockRing.qml and the demo stay JS.
use std::collections::BTreeMap;
use std::path::Path;

use visualizer_core::lock_ring::*;
use visualizer_core::{KICK_SLOTS, PLAYED_OUT};

fn read(file: &str) -> String {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    std::fs::read_to_string(root.join(file)).unwrap_or_else(|e| panic!("{file}: {e}"))
}

/// ring.frag without its comments.
fn code() -> String {
    read("lock-ring/shaders/ring.frag").lines().map(|l| l.split("//").next().unwrap()).collect::<Vec<_>>().join("\n")
}

/// Plain arithmetic: numbers, the constants defined above, + - * / and parentheses.
struct Expr<'a> {
    text: &'a [u8],
    at: usize,
    known: &'a BTreeMap<String, f64>,
}

impl Expr<'_> {
    fn peek(&mut self) -> Option<u8> {
        while self.text.get(self.at) == Some(&b' ') {
            self.at += 1;
        }
        self.text.get(self.at).copied()
    }

    fn sum(&mut self) -> f64 {
        let mut x = self.product();
        while let Some(op @ (b'+' | b'-')) = self.peek() {
            self.at += 1;
            let y = self.product();
            x = if op == b'+' { x + y } else { x - y };
        }
        x
    }

    fn product(&mut self) -> f64 {
        let mut x = self.atom();
        while let Some(op @ (b'*' | b'/')) = self.peek() {
            self.at += 1;
            let y = self.atom();
            x = if op == b'*' { x * y } else { x / y };
        }
        x
    }

    fn atom(&mut self) -> f64 {
        match self.peek() {
            Some(b'(') => {
                self.at += 1;
                let x = self.sum();
                assert_eq!(self.peek(), Some(b')'));
                self.at += 1;
                x
            }
            Some(b'-') => {
                self.at += 1;
                -self.atom()
            }
            _ => {
                let start = self.at;
                while self.text.get(self.at).is_some_and(|c| c.is_ascii_alphanumeric() || b"._".contains(c)) {
                    self.at += 1;
                }
                let word = std::str::from_utf8(&self.text[start..self.at]).unwrap();
                word.parse()
                    .unwrap_or_else(|_| *self.known.get(word).unwrap_or_else(|| panic!("{word} isn't defined above")))
            }
        }
    }
}

/// ring.frag's `const float NAME = expr;` lines, evaluated in order (an expression may use the
/// constants above it).
fn shader_constants() -> BTreeMap<String, f64> {
    let mut values = BTreeMap::new();
    for line in code().lines() {
        let Some(rest) = line.strip_prefix("const float ") else { continue };
        let (name, expr) = rest.split_once('=').unwrap();
        let expr = expr.split(';').next().unwrap();
        let mut parser = Expr { text: expr.as_bytes(), at: 0, known: &values };
        let value = parser.sum();
        assert_eq!(parser.peek(), None, "{name} = {expr} is plain arithmetic");
        values.insert(name.trim().to_owned(), value);
    }
    values
}

#[test]
fn ring_frags_constants_match_the_cores() {
    let frag = shader_constants();
    let ours = [
        // The Dial's size in the widget.
        ("DIAL_RATIO", DIAL_RATIO),
        // Where a Shockwave starts, how far it reaches, how fast it grows and fades, when it has
        // played out.
        ("KICK_ORIGIN", KICK_ORIGIN),
        ("MAX_REACH", MAX_REACH),
        ("KICK_GROW", KICK_GROW),
        ("KICK_FADE", KICK_FADE),
        ("PLAYED_OUT", PLAYED_OUT),
        // How near a Shockwave's front a radius feels it crossing, how the ribbons surge.
        ("CROSSING_LEAD", CROSSING_LEAD),
        ("CROSSING_TRAIL", CROSSING_TRAIL),
        ("SURGE_WIDTH", SURGE_WIDTH),
        ("SURGE_LIFT", SURGE_LIFT),
        // How a Shockwave strays from round, and how wild a Kick's power makes it.
        ("SHAPE_REACH", SHAPE_REACH),
        ("SHAPE_LIGHT", SHAPE_LIGHT),
        ("ROUGH_REACH", ROUGH_REACH),
        ("ROUGH_LIGHT", ROUGH_LIGHT),
        ("SHAPE_CALM", SHAPE_CALM),
        ("SHAPE_SOFT", SHAPE_SOFT),
        ("SHAPE_HARD", SHAPE_HARD),
        // The Aura's push, the Center Punch.
        ("AURA_PUSH", AURA_PUSH),
        ("AURA_RISE", AURA_RISE),
        ("AURA_FALL", AURA_FALL),
        ("PUNCH_FADE", PUNCH_FADE),
        // The ribbon's idle and music waves, the Aura's own reach.
        ("IDLE_REACH", IDLE_REACH),
        ("IDLE_DRIFT", IDLE_DRIFT),
        ("IDLE_BREATH", IDLE_BREATH),
        ("IDLE_GLOW", IDLE_GLOW),
        ("RIBBON_REACH", RIBBON_REACH),
        ("RIBBON_RIPPLE", RIBBON_RIPPLE),
        ("RIBBON_ROUND", RIBBON_ROUND),
        ("RIBBON_SMOOTH", RIBBON_SMOOTH),
        ("AURA_REACH", AURA_REACH),
        ("AURA_RIPPLE", AURA_RIPPLE),
        // The hands' wave.
        ("WAVE_PERIODS", WAVE_PERIODS),
        ("WAVE_RISE", WAVE_RISE),
        ("WAVE_FALL", WAVE_FALL),
        ("WAVE_TIP", WAVE_TIP),
        ("WAVE_RIPPLE", WAVE_RIPPLE),
    ];
    for (name, value) in ours {
        let theirs = *frag.get(name).unwrap_or_else(|| panic!("ring.frag defines {name}"));
        assert!((theirs - value).abs() < 1e-9, "{name}: ring.frag has {theirs}, the core {value}");
    }
}

#[test]
fn the_shader_and_the_core_both_have_8_kick_slots() {
    assert_eq!(KICK_SLOTS, 8);
    assert!(code().lines().any(|l| l.trim_end() == "const int KICKS = 8;"));
}

// PHASE_WRAP is seamless only for these strand multiples (tests/lock_hands.rs).
#[test]
fn the_hands_strands_run_at_their_hands_phase_times_1_1_5_and_2() {
    assert!(code().contains("float phase = wave * (1.0 + 0.5 * fk)"));
}

/// The part of ring.frag's main() between `from` and `to`.
fn main_between(from: &str, to: &str) -> String {
    let code = code();
    let main = &code[code.find("void main()").unwrap()..];
    let start = main.find(from).unwrap_or_else(|| panic!("{from}"));
    let end = start + main[start..].find(to).unwrap_or_else(|| panic!("{to}"));
    main[start..end].to_owned()
}

// hour_points(): they flash with the Shockwave crossing their radius, not the hands' flash.
#[test]
fn the_hour_points_flash_by_the_shockwave_crossing_them() {
    let points = main_between("for (int i = 0; i < 12; i++)", "col = col / (1.0");
    assert!(points.contains("shockwaveCrossing("));
    assert!(!points.contains("handFlash"));
    assert_eq!(HOUR_POINTS, 12);
}

// hour_points(): they ride the ribbon, each surged where its strand sits before the surge, as the
// ribbons are.
#[test]
fn the_ribbons_and_the_hour_points_surge_alike() {
    let strands = main_between("for (int k = 0; k < 3; k++)", "col += ribbon");
    let points = main_between("for (int i = 0; i < 12; i++)", "col = col / (1.0");
    assert!(strands.contains("ribbonSurge(ribbonRadius(theta, calm, k), theta)"));
    assert!(points.contains("ribbonSurge(ribbonRadius(th, min(1.0, pm), 0), th)"));
}

// A Shockwave hits without shaking the ring: nothing offsets where the shader draws.
#[test]
fn nothing_shakes() {
    let code = code();
    assert!(!code.to_lowercase().contains("shake"));
    assert!(code.contains("vec2 p = qt_TexCoord0 * 2.0 - 1.0;"));
}

#[test]
fn ring_frag_spells_out_no_other_copy_of_the_dial_ratio() {
    let code = code();
    let copies =
        code.match_indices("0.34").filter(|(i, _)| !code[i + 4..].starts_with(|c: char| c.is_ascii_digit())).count();
    assert_eq!(copies, 1, "only in DIAL_RATIO");
}

// The Lock Ring's Lyric Words (lock_ring::word_placement) lay words on the strands and Hands as
// ring.frag draws them, and color them as ring.frag does. ring.frag spells some of those numbers
// out inline; these are its lines.
mod the_lyric_words_ride_and_glow_like_ring_frags_strands_and_hands {
    use super::*;
    use visualizer_core::lyric_line::{HAND_COUNT, RIBBONS};

    fn main() -> String {
        let code = code();
        code[code.find("void main()").unwrap()..].to_owned()
    }

    #[test]
    fn the_ribbons_are_the_strands_ring_frag_draws_and_the_hands_its_hands() {
        let main = main();
        let ribbon = &main[main.find("vec3 ribbon = vec3(0.0);").expect("ring.frag's ribbon")..];
        assert!(ribbon.contains(&format!("for (int k = 0; k < {RIBBONS}; k++)")), "{RIBBONS} strands");
        assert_eq!(HAND_COUNT, HANDS.len());
    }

    #[test]
    fn catppuccins_colors_are_ring_frags() {
        let code = code();
        for (name, color) in [("LAVENDER", RING_LAVENDER), ("MAUVE", RING_MAUVE), ("PINK", RING_PINK), ("BLUE", RING_BLUE)] {
            let line = code
                .lines()
                .find(|l| l.split_whitespace().take(3).eq(["const", "vec3", name]))
                .unwrap_or_else(|| panic!("{name}"));
            let values = &line[line.find('(').unwrap() + 1..line.find(')').unwrap()];
            for (v, c) in values.split(',').zip(color) {
                let v: f64 = v.trim().parse().unwrap();
                assert!((v - c as f64 / 255.0).abs() < 0.002, "{name}: {v} vs {c}");
            }
        }
    }

    #[test]
    fn palette_cycles_through_ring_palette_and_the_strands_and_hands_deepen_it_by_saturation() {
        let code = code();
        let name = |c: [u8; 3]| match c {
            RING_LAVENDER => "LAVENDER",
            RING_MAUVE => "MAUVE",
            RING_PINK => "PINK",
            RING_BLUE => "BLUE",
            _ => panic!("{c:?}"),
        };
        let cycle: Vec<&str> = RING_PALETTE.iter().map(|&c| name(c)).collect();
        assert!(code.contains(&format!("vec3 c[7] = vec3[7]({});", cycle.join(", "))));
        assert!(main().contains(&format!("+ level * {RIBBON_HUE_LEVEL}, {SATURATION}, 1.0);")));
        assert!(code.contains(&format!("pow(color, vec3(1.0 + 1.5 * {SATURATION}))")));
    }

    #[test]
    fn a_ribbons_level_and_hue() {
        let main = main();
        assert!(main.contains(&format!(
            "float music = {RIBBON_MUSIC_GAIN} * ribbonSpectrum(s) * (1.0 + {RIBBON_MUSIC_KICK} * ubuf.kick);"
        )));
        assert!(main.contains(&format!("float hueBase = t * {RIBBON_HUE_TIME} + s * {RIBBON_HUE_SPECTRUM};")));
        assert!(main.contains(&format!(
            "pal(hueBase + fk * {RIBBON_HUE_RIBBON} + s * {RIBBON_HUE_ALONG} + level * {RIBBON_HUE_LEVEL}, "
        )));
    }

    #[test]
    fn each_hands_color_and_its_main_strands_phase() {
        let (main, code) = (main(), code());
        let names = ["LAVENDER", "MAUVE", "PINK"];
        for (i, axis) in ["x", "y", "z"].iter().enumerate() {
            assert_eq!(HAND_COLORS[i], [RING_LAVENDER, RING_MAUVE, RING_PINK][i]);
            let call = format!("hand(q, {i}.0, ubuf.handAngle.{axis},");
            let line = main[main.find(&call).unwrap_or_else(|| panic!("{call}"))..].lines().next().unwrap().to_owned();
            assert!(line.ends_with(&format!(", {});", names[i])), "{line}");
        }
        assert!(code.contains(&format!("float phase = wave * (1.0 + 0.5 * fk) + fk * 2.1 + index * {HAND_PHASE};")));
    }
}

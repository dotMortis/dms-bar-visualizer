// The one Kick detector, ported from docs/kick.mjs (v0.10.0) operation for operation, so it fires
// the same Kicks. Fixed-size state only: pushing a frame never allocates.

use crate::BANDS;

/// cava's frequency range, which the audio pipeline configures it with.
const LOW_HZ: f64 = 30.0;
const HIGH_HZ: f64 = 14000.0;
/// The sample rate of cava's pulse input.
const RATE: f64 = 44100.0;

/// How much of each band's running average is left after a second: 0.92 per frame at 60 fps.
fn average_keep() -> f64 {
    0.92f64.powf(60.0)
}

/// How much of the kick range's recent peak is left after a second: it halves in 1.15 s.
fn peak_keep() -> f64 {
    0.99f64.powf(60.0)
}

/// The peak's floor on cava's scale, so a near-silent range can't fire Kicks on noise.
const PEAK_FLOOR: f64 = 0.05;
/// A band below this fraction of the peak is too quiet to fire a Kick.
const QUIET: f64 = 0.15;
/// One Kick per hit: a hit has ended once the range's level has stayed under half its top for
/// this many seconds. A short dip isn't the end: a ringing kick beats against a bass note.
const SETTLE: f64 = 0.2;
/// A new hit can come in above the band the last one rings in, in bands it has left: fallen to
/// this fraction of their top. Not half: a 16th note before the beat leaves them at 0.5-0.55.
const FALLEN_TO: f64 = 0.6;

/// Where cava 1.0 puts a band: it adds up the FFT bins first..=last of an FFT of `size` samples
/// and scales the sum by `gain`.
#[derive(Clone, Copy, Default)]
struct Band {
    size: f64,
    first: f64,
    last: f64,
    gain: f64,
}

#[derive(Clone, Copy, Default)]
struct Edge {
    size: f64,
    bin: f64,
    last: f64,
    hz: f64,
}

fn cava_layout() -> [Band; BANDS] {
    let fft = 4096.0; // cava's FFT size at 44.1 kHz; bands below 100 Hz use one twice as long
    let mut edges = [Edge::default(); BANDS + 1];
    for n in 0..=BANDS {
        let prev = if n > 0 { Some(edges[n - 1]) } else { None };
        // BANDS + 1 cutoffs, evenly spaced on a log scale. One that crowds into the cutoff below
        // moves up past it by about a bass bin.
        let mut hz = LOW_HZ * (HIGH_HZ / LOW_HZ).powf(n as f64 / BANDS as f64);
        if let Some(p) = prev {
            if p.hz >= hz {
                hz = p.hz + (RATE / (2.0 * fft)).floor();
            }
        }
        // Each cutoff moves to an FFT bin, and a band below it gets at least one bin.
        let size = if hz < 100.0 { 2.0 * fft } else { fft };
        let mut bin = if size > fft { (hz * size / RATE).floor() } else { (hz * size / RATE).ceil() };
        let mut last = 0.0; // of the band below this cutoff
        if let Some(p) = prev {
            if p.size == size {
                bin = bin.max(p.bin + 1.0);
                last = bin - 1.0;
            } else {
                // The last bass band ends at this cutoff, in the bass FFT's bins.
                last = (hz * p.size / RATE).floor() - 1.0;
                if last < p.bin {
                    last = p.bin + 1.0;
                }
            }
        }
        edges[n] = Edge { size, bin, last, hz: bin * RATE / size };
    }
    let mut layout = [Band::default(); BANDS];
    for n in 0..BANDS {
        let (size, first) = (edges[n].size, edges[n].bin);
        let (last, cutoff) = (edges[n + 1].last, edges[n + 1].hz);
        // cava's EQ: it divides by log2(size), boosts higher bands by their upper cutoff^0.85 and
        // averages over the band's bins. A sine's peak in an FFT also grows with the FFT's size.
        let eq = cutoff.powf(0.85) / size.log2() / (last - first + 1.0);
        layout[n] = Band { size, first, last, gain: eq * size };
    }
    layout
}

/// A sine's magnitude in an FFT bin d bins from its frequency, through cava's Hann window,
/// relative to its magnitude in a bin right on it.
fn hann(d: f64) -> f64 {
    let sinc = |x: f64| if x == 0.0 { 1.0 } else { (std::f64::consts::PI * x).sin() / (std::f64::consts::PI * x) };
    (sinc(d) + (sinc(d - 1.0) + sinc(d + 1.0)) / 2.0).abs()
}

/// The band cava shows a sine of this frequency in most, after its window and EQ.
fn band_at(layout: &[Band; BANDS], hz: f64) -> usize {
    // NaN can't come from the settings (non-finite numbers get their default), but stays total.
    let hz = if hz.is_nan() { LOW_HZ } else { hz.clamp(LOW_HZ, HIGH_HZ) };
    let (mut best, mut loudest) = (0, 0.0);
    for (n, band) in layout.iter().enumerate() {
        let mut sum = 0.0;
        let mut bin = band.first;
        while bin <= band.last {
            sum += hann(hz * band.size / RATE - bin);
            bin += 1.0;
        }
        if sum * band.gain > loudest {
            loudest = sum * band.gain;
            best = n;
        }
    }
    best
}

/// The hit the last Kick fired for, until it has ended.
#[derive(Clone, Copy)]
struct Hit {
    top: f64,                 // the kick range's highest level during the hit
    quiet_since: Option<f64>, // when the level went under half of top, while it stays there
    front: usize,             // the lowest band the hit has run down to
    band_top: [f64; BANDS],   // each band's highest value during the hit
    fallen: [bool; BANDS],    // the bands that have fallen to FALLEN_TO of it...
    low: [f64; BANDS],        // ...and their lowest value since
}

/// The kick settings the detector runs on.
#[derive(Clone, Copy)]
pub(crate) struct KickSettings {
    pub threshold: f64,
    pub low_hz: f64,
    pub high_hz: f64,
    pub cooldown: f64,
    pub speed: f64,
}

pub(crate) struct KickDetector {
    layout: [Band; BANDS],
    average_keep: f64,
    peak_keep: f64,
    slow: [f64; BANDS],     // each band's running average
    previous: [f64; BANDS], // the last frame's values, shown until this one
    rises: [f64; BANDS],    // this frame's rise of each band above its average
    threshold: f64,
    cooldown: f64,
    speed: f64,
    from: usize,
    to: usize,
    last_frame: Option<f64>, // the last frame's time
    clock: f64,              // real seconds of frames so far, a step back counted as none
    animation: f64,          // the animation clock kickCooldown runs on: real seconds times speed
    last_kick: f64,          // on the animation clock
    peak: f64,               // the kick range's recent peak level, slowly released
    hit: Option<Hit>,
}

impl KickDetector {
    pub fn new(settings: KickSettings) -> Self {
        let mut detector = KickDetector {
            layout: cava_layout(),
            average_keep: average_keep(),
            peak_keep: peak_keep(),
            slow: [0.0; BANDS],
            previous: [0.0; BANDS],
            rises: [0.0; BANDS],
            threshold: 0.0,
            cooldown: 0.0,
            speed: 1.0,
            from: 0,
            to: 1,
            last_frame: None,
            clock: 0.0,
            animation: 0.0,
            last_kick: f64::NEG_INFINITY,
            peak: PEAK_FLOOR,
            hit: None,
        };
        detector.configure(settings);
        detector
    }

    /// New settings take effect on the next frame; the running state carries over.
    pub fn configure(&mut self, settings: KickSettings) {
        self.threshold = settings.threshold;
        self.cooldown = settings.cooldown;
        self.speed = settings.speed;
        self.from = band_at(&self.layout, settings.low_hz);
        self.to = self.from.max(band_at(&self.layout, settings.high_hz)) + 1;
    }

    /// One frame: the bands in 0..1 and when they came, in real seconds (a step back counts as
    /// none). The Kick's power (0.5..1) when one fires.
    #[allow(clippy::needless_range_loop)] // indexes several arrays in step, as docs/kick.mjs does
    pub fn push(&mut self, values: &[f64; BANDS], time: f64) -> Option<f64> {
        let (from, to) = (self.from, self.to);
        // The averages and the peak take in the last frame for as long as it was shown, so a
        // frame repeated at a higher frame rate weighs the same as at 60 fps.
        let dt = self.last_frame.map_or(0.0, |last| (time - last).max(0.0));
        self.last_frame = Some(time);
        self.clock += dt;
        self.animation += dt * self.speed;
        let keep = self.average_keep.powf(dt);
        let (mut level, mut previous_level) = (0.0f64, 0.0f64); // the kick range's, this frame and the last
        for i in from..to {
            level = level.max(values[i]);
            previous_level = previous_level.max(self.previous[i]);
        }
        self.peak = previous_level.max(self.peak * self.peak_keep.powf(dt)).max(PEAK_FLOOR);
        // Rises are measured against the peak, or this frame's level if it goes higher.
        let scale = self.peak.max(level);
        // Each band in the kick range on its own, so a wide range still catches a note in one band.
        let (mut rise, mut band, mut repeat) = (0.0, from, true); // the largest rise, and its band
        let (mut rising, mut rising_band) = (0.0, from); // the same, of the bands that went up
        for i in 0..BANDS {
            self.slow[i] = self.slow[i] * keep + self.previous[i] * (1.0 - keep);
            repeat = repeat && values[i] == self.previous[i];
            let up = values[i] > self.previous[i];
            self.previous[i] = values[i];
            self.rises[i] =
                if i >= from && i < to && values[i] > QUIET * scale { values[i] - self.slow[i] } else { 0.0 };
            if self.rises[i] > rise {
                rise = self.rises[i];
                band = i;
            }
            if up && self.rises[i] > rising {
                rising = self.rises[i];
                rising_band = i;
            }
        }
        // The same frame pushed again was measured when it came.
        if repeat {
            return None;
        }
        if let Some(hit) = &mut self.hit {
            if hit_ended(hit, level, self.clock) {
                self.hit = None;
            }
        }
        // Once the last hit has ended, any band going up can fire. One on its way down is the
        // tail of something earlier.
        let (onset, at) = match &mut self.hit {
            Some(hit) => new_hit(hit, values, &self.rises, from, to, scale, rise, band),
            None => (rising, rising_band),
        };
        if onset / scale > self.threshold && self.animation - self.last_kick >= self.cooldown {
            self.last_kick = self.animation;
            self.hit = Some(Hit {
                top: level,
                quiet_since: None,
                front: at,
                band_top: *values,
                fallen: [false; BANDS],
                low: [0.0; BANDS],
            });
            // From 0.5 to 1 for a rise as big as the peak before this hit, so accents stand out.
            return Some(0.5 + 0.5 * (onset / self.peak).min(1.0));
        }
        None
    }
}

/// Whether the hit has ended: the range's level has stayed under half its top for SETTLE seconds.
fn hit_ended(hit: &mut Hit, level: f64, clock: f64) -> bool {
    hit.top = hit.top.max(level);
    if level >= hit.top / 2.0 {
        hit.quiet_since = None;
    } else if hit.quiet_since.is_none() {
        hit.quiet_since = Some(clock);
    }
    hit.quiet_since.is_some_and(|since| clock - since >= SETTLE)
}

/// The largest rise of a new hit while the last one rings, and its band: one the last hit has
/// left, above where it rings (a bass note beating against it, or its tail, rises at or below that).
#[allow(clippy::too_many_arguments)]
fn new_hit(
    hit: &mut Hit,
    values: &[f64; BANDS],
    rises: &[f64; BANDS],
    from: usize,
    to: usize,
    scale: f64,
    rise: f64,
    band: usize,
) -> (f64, usize) {
    // The hit runs down to the band rising most, if by more than a hint.
    if rise > QUIET * scale {
        hit.front = hit.front.min(band);
    }
    let (mut onset, mut at) = (0.0, band);
    for i in from..to {
        hit.band_top[i] = hit.band_top[i].max(values[i]);
        if i <= hit.front {
            continue;
        }
        if !hit.fallen[i] && values[i] < FALLEN_TO * hit.band_top[i] {
            hit.fallen[i] = true;
            hit.low[i] = values[i];
        }
        if !hit.fallen[i] {
            continue;
        }
        hit.low[i] = hit.low[i].min(values[i]);
        // At least QUIET at any kickThreshold: a rebound of the ringing kick is less.
        let band_rise = rises[i].min(values[i] - hit.low[i]);
        if band_rise > onset && band_rise > QUIET * scale {
            onset = band_rise;
            at = i;
        }
    }
    (onset, at)
}

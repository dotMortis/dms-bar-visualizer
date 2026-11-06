// kickLowHz and kickHighHz select the cava bands that actually contain those frequencies. Checked
// against a stepped sine sweep recorded through real cava (fixtures/record.py, scenario "tones").
// Ported from tests/band-mapping.test.mjs.
mod common;

use common::*;
use visualizer_core::{band_at, Visualizer, BANDS};

/// cava's bass FFT spans 186 ms (8192 samples at 44.1 kHz). From 0.2 s into a tone until it
/// ends, cava sees nothing else.
const SETTLED_AFTER: f64 = 0.2;

/// The band cava lit up most during a tone: the highest mean over its settled frames.
fn loudest_band(frames: &[Bands], tone: Tone) -> usize {
    let settled: Vec<&Bands> =
        frames.iter().filter(|f| f.time >= tone.at + SETTLED_AFTER && f.time <= tone.at + tone.length).collect();
    let mean: Vec<f64> =
        (0..BANDS).map(|i| settled.iter().map(|f| f.values[i]).sum::<f64>() / settled.len() as f64).collect();
    // The first of the loudest, as indexOf(max) does.
    let max = mean.iter().copied().fold(f64::MIN, f64::max);
    mean.iter().position(|&m| m == max).unwrap()
}

/// A tone this close to a band edge may land in either neighbour.
const EDGE: f64 = 0.03;

#[test]
fn every_tone_of_the_sweep_maps_to_the_band_cava_lit_up_most() {
    let sweep = fixture("tones");
    assert!(!sweep.tones.is_empty());
    let mut wrong = Vec::new();
    for &tone in &sweep.tones {
        let cava = loudest_band(&sweep.frames, tone);
        let near = [tone.hz * (1.0 - EDGE), tone.hz, tone.hz * (1.0 + EDGE)].map(band_at);
        if !near.contains(&cava) {
            wrong.push(format!("{} Hz: cava band {cava}, mapped to {}", tone.hz, band_at(tone.hz)));
        }
    }
    assert!(wrong.is_empty(), "{} of {} tones in the wrong band: {wrong:?}", wrong.len(), sweep.tones.len());
}

#[test]
fn hz_35_40_50_and_90_map_to_the_bands_cava_puts_them_in() {
    // A plain log scale puts these in bands 0, 1, 2 and 5. No slack at a band edge for them.
    let sweep = fixture("tones");
    for (hz, cava) in [(35.0, 1), (40.0, 2), (50.0, 3), (90.0, 6)] {
        let tone = *sweep.tones.iter().find(|t| t.hz == hz).unwrap();
        assert_eq!(loudest_band(&sweep.frames, tone), cava, "{hz} Hz recorded");
        assert_eq!(band_at(hz), cava, "{hz} Hz mapped");
    }
}

/// Whether a hit in this band alone, after a second of silence, fires a Kick on these settings.
fn fires_on(settings: &str, band: usize) -> bool {
    let mut visualizer = Visualizer::new();
    visualizer.configure(settings);
    let mut bands = [0.0; BANDS];
    for n in 0..90 {
        bands[band] = if n >= 60 { 0.8 } else { 0.0 };
        visualizer.push_bands(&bands, n as f64 / 60.0);
    }
    visualizer.frame().kick_count > 0
}

#[test]
fn the_kick_range_listens_to_every_band_from_kick_low_hzs_up_to_and_including_kick_high_hzs() {
    // 30 to 90 Hz: cava puts 30 Hz in band 0 and 90 Hz in band 6.
    let settings = r#"{"kickLowHz": 30, "kickHighHz": 90}"#;
    let firing: Vec<usize> = (0..BANDS).filter(|&b| fires_on(settings, b)).collect();
    assert_eq!(firing, (0..7).collect::<Vec<_>>());
}

#[test]
fn frequencies_outside_cavas_30_hz_to_14_khz_select_its_first_and_last_band() {
    for (low, high) in [(10.0, 20000.0), (0.0, 22050.0), (-5.0, 1e6)] {
        let settings = format!(r#"{{"kickLowHz": {low}, "kickHighHz": {high}}}"#);
        let firing: Vec<usize> = (0..BANDS).filter(|&b| fires_on(&settings, b)).collect();
        assert_eq!(firing, (0..BANDS).collect::<Vec<_>>(), "{low} to {high} Hz");
    }
}

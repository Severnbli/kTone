//! Low range mode: G1 (49 Hz) .. C2 for octavist basses, with a 4096-sample
//! frame and `TrackerConfig::low_range`.

use ktone_core::pitch::{
    Mpm, PitchTracker, TrackedPitch, TrackerConfig, LOW_RANGE_FRAME_SIZE, LOW_RANGE_MIN_HZ,
};
use std::f64::consts::TAU;

const FRAME: usize = LOW_RANGE_FRAME_SIZE;
const HOP: usize = 512;
const RATES: [f64; 2] = [44100.0, 48000.0];
/// G1 .. C2: the notes the mode exists for.
const LOW_NOTES: std::ops::RangeInclusive<i32> = 31..=36;

fn midi_to_hz(midi: f64) -> f64 {
    440.0 * ((midi - 69.0) / 12.0).exp2()
}

fn cents_between(measured: f64, expected: f64) -> f64 {
    1200.0 * (measured / expected).log2()
}

/// Deterministic xorshift64* PRNG.
struct Rng(u64);

impl Rng {
    fn uniform(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let v = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (v >> 11) as f64 / (1u64 << 53) as f64
    }

    fn gauss(&mut self) -> f64 {
        let u1 = self.uniform().max(1e-12);
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (TAU * u2).cos()
    }
}

/// Additive oscillator: `harmonics[k]` is the amplitude of harmonic `k + 1`.
fn synth(sr: f64, len: usize, amp: f64, harmonics: &[f64], freq: impl Fn(f64) -> f64) -> Vec<f32> {
    let mut phase = 0.3;
    let norm: f64 = harmonics.iter().map(|a| a.abs()).sum::<f64>().max(1e-12);
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        let f = freq(i as f64 / sr);
        let mut s = 0.0;
        for (k, a) in harmonics.iter().enumerate() {
            let h = (k + 1) as f64;
            if f * h < sr / 2.0 {
                s += a * (h * phase).sin();
            }
        }
        out.push((amp * s / norm) as f32);
        phase = (phase + TAU * f / sr) % (TAU * 64.0);
    }
    out
}

fn add_noise(signal: &mut [f32], snr_db: f64, seed: u64) {
    let power: f64 = signal.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / signal.len() as f64;
    let sigma = (power / 10f64.powf(snr_db / 10.0)).sqrt();
    let mut rng = Rng(seed);
    for v in signal.iter_mut() {
        *v += (sigma * rng.gauss()) as f32;
    }
}

fn low_config(sr: f64) -> TrackerConfig {
    TrackerConfig::for_hop(sr as f32, HOP).low_range(FRAME, HOP)
}

fn low_tracker(sr: f64) -> PitchTracker {
    PitchTracker::new(sr as f32, FRAME, low_config(sr))
}

fn track(tracker: &mut PitchTracker, signal: &[f32], frame: usize) -> Vec<Option<TrackedPitch>> {
    signal
        .windows(frame)
        .step_by(HOP)
        .map(|f| tracker.process(f, 440.0))
        .collect()
}

/// Spectra of a low male voice: the fundamental of an octavist is often
/// weaker than the 2nd and 3rd harmonics, which invites octave-up errors.
const BASS_SPECTRA: [&[f64]; 5] = [
    &[1.0],
    &[1.0, 0.6, 0.3, 0.15],
    &[0.3, 1.0, 0.8, 0.5, 0.4, 0.3, 0.2, 0.1],
    &[0.15, 1.0, 0.6, 0.5, 0.3, 0.2],
    // Missing fundamental (a small phone mic rolls off below ~80 Hz).
    &[0.0, 1.0, 0.7, 0.5, 0.35, 0.25, 0.15, 0.1],
];

/// Asserts every pitched frame after the first `skip` shows `midi`, and at
/// least `min_share` of them are pitched.
fn assert_holds(out: &[Option<TrackedPitch>], midi: i32, skip: usize, min_share: f64, what: &str) {
    let tail = &out[skip..];
    let pitched: Vec<&TrackedPitch> = tail.iter().flatten().collect();
    assert!(
        pitched.len() as f64 >= min_share * tail.len() as f64,
        "{what}: only {}/{} frames pitched",
        pitched.len(),
        tail.len()
    );
    for p in pitched {
        assert_eq!(
            p.stable_midi, midi,
            "{what}: showed {} ({:.1} Hz)",
            p.stable_midi, p.frequency_hz
        );
    }
}

#[test]
fn config_lowers_min_hz_and_scales_drone_confirm() {
    let base = TrackerConfig::for_hop(48000.0, HOP);
    let low = base.low_range(FRAME, HOP);
    assert_eq!(low.min_hz, LOW_RANGE_MIN_HZ);
    assert!(LOW_RANGE_MIN_HZ < midi_to_hz(31.0) as f32 * 0.95);
    // A glitch stays in a 4096 frame for 8 hops: one more frame than that.
    assert_eq!(low.drone_confirm, 9);
    assert_eq!(low.max_hz, base.max_hz);
    assert_eq!(low.center_window, base.center_window);
    // A smaller frame never lowers the default.
    assert_eq!(base.low_range(2048, HOP).drone_confirm, base.drone_confirm);
    assert_eq!(base.low_range(FRAME, 0).drone_confirm, base.drone_confirm);
}

#[test]
fn default_mode_does_not_show_g1() {
    let sr = 48000.0;
    let signal = synth(sr, 48000, 0.3, BASS_SPECTRA[1], |_| midi_to_hz(31.0));
    let mut tracker = PitchTracker::new(sr as f32, 2048, TrackerConfig::for_hop(sr as f32, HOP));
    let out = track(&mut tracker, &signal, 2048);
    // Neither G1 nor its octave G2 (an octave error would be worse than nothing).
    assert!(
        out.iter()
            .flatten()
            .all(|p| p.stable_midi != 31 && p.stable_midi != 43),
        "default mode showed a note for G1"
    );
}

#[test]
fn detector_is_accurate_from_g1_to_c2() {
    for sr in RATES {
        let mut mpm = Mpm::new(sr as f32, FRAME);
        for midi in LOW_NOTES {
            let f = midi_to_hz(midi as f64);
            for harmonics in BASS_SPECTRA {
                let signal = synth(sr, FRAME * 3, 0.4, harmonics, |_| f);
                for frame in signal.windows(FRAME).step_by(HOP * 3 + 17).take(4) {
                    let est = mpm
                        .detect(frame)
                        .unwrap_or_else(|| panic!("no estimate for {f:.2} Hz {harmonics:?}"));
                    let err = cents_between(est.frequency_hz as f64, f);
                    assert!(
                        err.abs() <= 3.0,
                        "{f:.2} Hz {harmonics:?} at {sr}: {err:.2} cents"
                    );
                    assert!(est.clarity >= 0.9, "clarity {} at {f:.2} Hz", est.clarity);
                }
            }
        }
    }
}

#[test]
fn tracker_holds_low_notes_without_octave_errors() {
    for sr in RATES {
        for midi in LOW_NOTES {
            let f = midi_to_hz(midi as f64);
            for harmonics in BASS_SPECTRA {
                let signal = synth(sr, sr as usize, 0.3, harmonics, |_| f);
                let mut tracker = low_tracker(sr);
                let out = track(&mut tracker, &signal, FRAME);
                assert_holds(
                    &out,
                    midi,
                    0,
                    0.99,
                    &format!("{f:.2} Hz {harmonics:?} at {sr}"),
                );
                let last = out.last().unwrap().unwrap();
                assert!(last.cents.abs() < 3.0, "{} cents at {f:.2} Hz", last.cents);
                assert!(last.center_ready);
            }
        }
    }
}

#[test]
fn low_notes_in_noise_have_no_octave_errors() {
    let sr = 48000.0;
    for midi in LOW_NOTES {
        let f = midi_to_hz(midi as f64);
        for (i, harmonics) in BASS_SPECTRA.iter().enumerate() {
            let mut signal = synth(sr, 48000, 0.3, harmonics, |_| f);
            add_noise(&mut signal, 15.0, 7 + i as u64 + midi as u64 * 13);
            let mut tracker = low_tracker(sr);
            let out = track(&mut tracker, &signal, FRAME);
            assert_holds(
                &out,
                midi,
                0,
                0.9,
                &format!("{f:.2} Hz {harmonics:?} in noise"),
            );
        }
    }
}

#[test]
fn vibrato_on_g1_does_not_flicker() {
    let sr = 48000.0;
    let center = 31.0;
    // ±40 cents at 5 Hz, a bass voice spectrum.
    let signal = synth(sr, 96000, 0.3, BASS_SPECTRA[2], |t| {
        midi_to_hz(center + 0.4 * (TAU * 5.0 * t).sin())
    });
    let mut tracker = low_tracker(sr);
    let out = track(&mut tracker, &signal, FRAME);
    assert_holds(&out, 31, 0, 0.99, "G1 vibrato");
    let late: Vec<&TrackedPitch> = out[out.len() / 2..].iter().flatten().collect();
    for p in late {
        assert!(p.center_ready);
        assert!(
            p.center_cents.abs() < 12.0,
            "center {} cents",
            p.center_cents
        );
    }
}

#[test]
fn short_octave_glitches_on_g1_are_suppressed() {
    let sr = 48000.0;
    let f = midi_to_hz(31.0);
    let base = synth(sr, FRAME, 0.3, BASS_SPECTRA[1], |_| f);
    let up = synth(sr, FRAME, 0.3, BASS_SPECTRA[1], |_| 2.0 * f);
    let mut tracker = low_tracker(sr);
    let mut outputs = Vec::new();
    for _ in 0..10 {
        outputs.push(tracker.process(&base, 440.0));
    }
    for burst in 1..=3 {
        for _ in 0..burst {
            outputs.push(tracker.process(&up, 440.0));
        }
        for _ in 0..8 {
            outputs.push(tracker.process(&base, 440.0));
        }
    }
    for p in outputs {
        let p = p.expect("pitched");
        assert_eq!(p.stable_midi, 31);
        assert!(
            p.cents.abs() < 3.0,
            "octave glitch leaked: {} cents",
            p.cents
        );
    }
}

#[test]
fn leaps_between_low_and_high_notes_are_followed() {
    let sr = 48000.0;
    // G1 -> G3 -> C2 -> C5, half a second each.
    let notes = [31.0, 55.0, 36.0, 72.0];
    let signal = synth(sr, 4 * 24000, 0.3, BASS_SPECTRA[1], |t| {
        midi_to_hz(notes[((t / 0.5) as usize).min(3)])
    });
    let mut tracker = low_tracker(sr);
    let out = track(&mut tracker, &signal, FRAME);
    for (i, &midi) in notes.iter().enumerate() {
        // Frames ending in the last 0.2 s of each segment: settled on the note.
        let end = |k: usize| (k * HOP + FRAME) as f64 / sr;
        let shown: Vec<i32> = out
            .iter()
            .enumerate()
            .filter(|(k, _)| end(*k) > 0.5 * i as f64 + 0.3 && end(*k) <= 0.5 * (i + 1) as f64)
            .filter_map(|(_, p)| p.map(|p| p.stable_midi))
            .collect();
        assert!(!shown.is_empty(), "segment {i} not pitched");
        assert!(
            shown.iter().all(|&n| n == midi as i32),
            "segment {i}: {shown:?}"
        );
    }
}

#[test]
fn the_rest_of_the_voice_range_still_works() {
    for sr in RATES {
        for midi in (40..=84).step_by(4) {
            let f = midi_to_hz(midi as f64);
            let signal = synth(sr, 24000, 0.3, BASS_SPECTRA[1], |_| f);
            let mut tracker = low_tracker(sr);
            let out = track(&mut tracker, &signal, FRAME);
            assert_holds(&out, midi, 0, 0.99, &format!("{f:.2} Hz at {sr}"));
        }
    }
}

#[test]
fn below_the_floor_is_rejected() {
    let sr = 48000.0;
    // 40 Hz is under LOW_RANGE_MIN_HZ.
    let signal = synth(sr, 48000, 0.3, &[1.0], |_| 40.0);
    let mut tracker = low_tracker(sr);
    let out = track(&mut tracker, &signal, FRAME);
    assert!(
        out.iter().flatten().all(|p| p.stable_midi != 27),
        "40 Hz was shown"
    );
}

/// A rough low voice: random period jitter and amplitude shimmer, plus noise.
fn rough_voice(sr: f64, len: usize, midi: f64, seed: u64) -> Vec<f32> {
    let mut rng = Rng(seed);
    let f = midi_to_hz(midi);
    // Jitter: a slowly wandering ±1 % frequency offset, new value every ~20 ms.
    let steps = (len as f64 / sr / 0.02).ceil() as usize + 2;
    let offsets: Vec<f64> = (0..steps)
        .map(|_| 0.01 * rng.gauss().clamp(-2.0, 2.0))
        .collect();
    let mut signal = synth(sr, len, 0.3, BASS_SPECTRA[2], |t| {
        let k = t / 0.02;
        let i = k as usize;
        let a = k - i as f64;
        f * (1.0 + offsets[i] * (1.0 - a) + offsets[i + 1] * a)
    });
    for (i, v) in signal.iter_mut().enumerate() {
        let shimmer = 1.0 + 0.15 * (TAU * 3.1 * i as f64 / sr).sin();
        *v *= shimmer as f32;
    }
    add_noise(&mut signal, 10.0, seed ^ 0x5eed);
    signal
}

#[test]
fn rough_low_voice_is_tracked() {
    let sr = 48000.0;
    for midi in LOW_NOTES {
        for seed in 1..=3 {
            let signal = rough_voice(sr, 48000, midi as f64, seed * 31 + midi as u64);
            let mut tracker = low_tracker(sr);
            let out = track(&mut tracker, &signal, FRAME);
            assert_holds(
                &out,
                midi,
                0,
                0.9,
                &format!("rough voice {midi} seed {seed}"),
            );
        }
    }
}

#[test]
fn a_flat_g1_is_still_tracked() {
    // A G1 sung 60 cents flat (47.3 Hz).
    let sr = 48000.0;
    let signal = synth(sr, 48000, 0.3, BASS_SPECTRA[2], |_| midi_to_hz(30.4));
    let mut tracker = low_tracker(sr);
    let out = track(&mut tracker, &signal, FRAME);
    assert_holds(&out, 30, 0, 0.99, "flat G1");
}

#[test]
fn notes_under_the_floor_are_not_shown() {
    // E1 / F1 lie past the longest lag of a 2048 frame (47 Hz at 48 kHz),
    // where the detector picks a wrong lag and shows a wrong note (F♯1 for
    // F1). The 4096 frame reaches down to 23 Hz, sees the real pitch and
    // rejects it as under the floor.
    let sr = 48000.0;
    for midi in [28.0, 29.0] {
        let f = midi_to_hz(midi);
        assert!(f < LOW_RANGE_MIN_HZ as f64);
        for harmonics in &BASS_SPECTRA[1..4] {
            let signal = synth(sr, 48000, 0.3, harmonics, |_| f);
            let mut tracker = low_tracker(sr);
            let out = track(&mut tracker, &signal, FRAME);
            let wrong: Vec<i32> = out.iter().flatten().map(|p| p.stable_midi).collect();
            assert!(wrong.is_empty(), "{f:.2} Hz {harmonics:?} showed {wrong:?}");
        }
    }
}

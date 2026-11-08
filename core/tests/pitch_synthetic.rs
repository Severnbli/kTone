//! Pitch detection and tracking on synthetic signals.

use ktone_core::pitch::{Mpm, PitchTracker, TrackedPitch, TrackerConfig};
use std::f64::consts::TAU;

const FRAME: usize = 2048;
const HOP: usize = 512;
const RATES: [f64; 2] = [44100.0, 48000.0];
/// E2 .. C6.
const LOW_MIDI: i32 = 40;
const HIGH_MIDI: i32 = 84;

fn midi_to_hz(midi: f64) -> f64 {
    440.0 * ((midi - 69.0) / 12.0).exp2()
}

fn cents_between(measured: f64, expected: f64) -> f64 {
    1200.0 * (measured / expected).log2()
}

/// Tiny deterministic PRNG (xorshift64*) so tests need no dependencies.
struct Rng(u64);

impl Rng {
    fn uniform(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let v = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (v >> 11) as f64 / (1u64 << 53) as f64
    }

    /// Standard normal via Box-Muller.
    fn gauss(&mut self) -> f64 {
        let u1 = self.uniform().max(1e-12);
        let u2 = self.uniform();
        (-2.0 * u1.ln()).sqrt() * (TAU * u2).cos()
    }
}

/// Phase-accumulating additive oscillator. `freq(t)` is the instantaneous
/// fundamental in Hz; `harmonics[k]` is the amplitude of harmonic `k + 1`.
/// Harmonics at or above Nyquist are dropped.
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

fn sine(sr: f64, len: usize, amp: f64, freq: f64) -> Vec<f32> {
    synth(sr, len, amp, &[1.0], |_| freq)
}

fn sawtooth_harmonics(count: usize) -> Vec<f64> {
    (1..=count).map(|k| 1.0 / k as f64).collect()
}

fn add_noise(signal: &mut [f32], snr_db: f64, seed: u64) {
    let power: f64 = signal.iter().map(|&v| (v as f64).powi(2)).sum::<f64>() / signal.len() as f64;
    let sigma = (power / 10f64.powf(snr_db / 10.0)).sqrt();
    let mut rng = Rng(seed);
    for v in signal.iter_mut() {
        *v += (sigma * rng.gauss()) as f32;
    }
}

/// Runs the tracker over `signal` with the usual frame/hop.
fn track(tracker: &mut PitchTracker, signal: &[f32], a4: f32) -> Vec<Option<TrackedPitch>> {
    signal
        .windows(FRAME)
        .step_by(HOP)
        .map(|frame| tracker.process(frame, a4))
        .collect()
}

fn new_tracker(sr: f64) -> PitchTracker {
    PitchTracker::new(sr as f32, FRAME, TrackerConfig::default())
}

/// Max absolute cents error of `Mpm::detect` over several frames of `signal`.
fn detector_error(sr: f64, signal: &[f32], expected_hz: f64) -> f64 {
    let mut mpm = Mpm::new(sr as f32, FRAME);
    let mut worst: f64 = 0.0;
    for frame in signal.windows(FRAME).step_by(HOP * 3 + 17).take(4) {
        let est = mpm
            .detect(frame)
            .unwrap_or_else(|| panic!("no estimate for {expected_hz:.2} Hz at {sr}"));
        worst = worst.max(cents_between(est.frequency_hz as f64, expected_hz).abs());
    }
    worst
}

fn stable_notes(out: &[Option<TrackedPitch>]) -> Vec<i32> {
    out.iter().flatten().map(|p| p.stable_midi).collect()
}

fn count_switches(notes: &[i32]) -> usize {
    notes.windows(2).filter(|w| w[0] != w[1]).count()
}

// ---------------------------------------------------------------- detector

#[test]
fn pure_sines_across_voice_range_within_3_cents() {
    let mut worst: f64 = 0.0;
    for sr in RATES {
        for midi in LOW_MIDI..=HIGH_MIDI {
            for offset in [0.0, 0.23, -0.41] {
                let f = midi_to_hz(midi as f64 + offset);
                let signal = sine(sr, FRAME * 4, 0.5, f);
                let err = detector_error(sr, &signal, f);
                assert!(err <= 3.0, "{f:.2} Hz at {sr}: {err:.3} cents");
                worst = worst.max(err);
            }
        }
    }
    println!("pure sine worst error: {worst:.4} cents");
}

#[test]
fn clarity_of_pure_sine_is_high() {
    let mut mpm = Mpm::new(48000.0, FRAME);
    let signal = sine(48000.0, FRAME, 0.5, 220.0);
    let est = mpm.detect(&signal).expect("estimate");
    assert!(est.clarity > 0.95 && est.clarity <= 1.0, "{}", est.clarity);
}

#[test]
fn sawtooth_has_no_octave_errors() {
    let harmonics = sawtooth_harmonics(40);
    let mut worst: f64 = 0.0;
    for sr in RATES {
        for midi in (LOW_MIDI..=HIGH_MIDI).step_by(3) {
            let f = midi_to_hz(midi as f64);
            let signal = synth(sr, FRAME * 4, 0.5, &harmonics, |_| f);
            let err = detector_error(sr, &signal, f);
            assert!(err <= 3.0, "sawtooth {f:.2} Hz at {sr}: {err:.3} cents");
            worst = worst.max(err);
        }
    }
    println!("sawtooth worst error: {worst:.4} cents");
}

#[test]
fn missing_fundamental_is_still_found() {
    // Harmonics 2..8 only, 1/k rolloff.
    let mut harmonics = sawtooth_harmonics(8);
    harmonics[0] = 0.0;
    let mut worst: f64 = 0.0;
    for sr in RATES {
        for midi in (LOW_MIDI..=HIGH_MIDI).step_by(4) {
            let f = midi_to_hz(midi as f64);
            let signal = synth(sr, FRAME * 4, 0.5, &harmonics, |_| f);
            let err = detector_error(sr, &signal, f);
            assert!(
                err <= 3.0,
                "missing fundamental {f:.2} Hz at {sr}: {err:.3} cents"
            );
            worst = worst.max(err);
        }
    }
    println!("missing fundamental worst error: {worst:.4} cents");
}

#[test]
fn weak_fundamental_and_strong_second_harmonic() {
    let cases: [&[f64]; 3] = [
        // Weak fundamental under a rich spectrum.
        &[0.1, 1.0, 0.6, 0.5, 0.3, 0.2],
        // 2nd harmonic twice as strong as the fundamental.
        &[0.5, 1.0],
        // 2nd harmonic dominant with some upper partials.
        &[0.4, 1.0, 0.3, 0.2],
    ];
    for harmonics in cases {
        for sr in RATES {
            for midi in (LOW_MIDI..=HIGH_MIDI).step_by(4) {
                let f = midi_to_hz(midi as f64);
                let signal = synth(sr, FRAME * 4, 0.5, harmonics, |_| f);
                let err = detector_error(sr, &signal, f);
                assert!(
                    err <= 3.0,
                    "{harmonics:?} {f:.2} Hz at {sr}: {err:.3} cents"
                );
            }
        }
    }
}

#[test]
fn sine_in_white_noise_at_20_db() {
    // Single raw frames jitter a little in broadband noise (worst at E2, where
    // a 2048 frame holds only ~3.5 periods); the mean stays within 3 cents.
    let mut worst: f64 = 0.0;
    let mut total = 0.0;
    let mut count = 0;
    for (i, sr) in RATES.into_iter().enumerate() {
        for midi in LOW_MIDI..=HIGH_MIDI {
            let f = midi_to_hz(midi as f64);
            let mut signal = sine(sr, FRAME * 6, 0.3, f);
            add_noise(&mut signal, 20.0, 1 + midi as u64 * 7 + i as u64);
            let mut mpm = Mpm::new(sr as f32, FRAME);
            for frame in signal.windows(FRAME).step_by(HOP) {
                let est = mpm.detect(frame).expect("noisy sine detected");
                let err = cents_between(est.frequency_hz as f64, f).abs();
                assert!(err <= 12.0, "noisy {f:.2} Hz at {sr}: {err:.3} cents");
                worst = worst.max(err);
                total += err;
                count += 1;
            }
        }
    }
    let mean = total / count as f64;
    println!("20 dB SNR: mean {mean:.4} cents, worst {worst:.4} cents");
    assert!(mean <= 3.0, "mean error {mean:.3} cents");
}

#[test]
fn tracker_output_in_white_noise_at_20_db() {
    // Broadband noise hurts the lowest notes most; the median filter keeps the
    // displayed deviation well inside the +-10 cent green zone everywhere.
    let mut worst: f64 = 0.0;
    let mut total = 0.0;
    let mut count = 0;
    for (i, sr) in RATES.into_iter().enumerate() {
        for midi in LOW_MIDI..=HIGH_MIDI {
            let f = midi_to_hz(midi as f64);
            let mut signal = sine(sr, (sr * 0.5) as usize, 0.3, f);
            add_noise(&mut signal, 20.0, 31 + midi as u64 * 3 + i as u64);
            let mut tracker = new_tracker(sr);
            let out = track(&mut tracker, &signal, 440.0);
            assert!(
                out.iter().all(Option::is_some),
                "{f:.2} Hz at {sr} has gaps"
            );
            for p in out.iter().flatten() {
                assert_eq!(p.stable_midi, midi);
                worst = worst.max(p.cents.abs() as f64);
                total += p.cents.abs() as f64;
                count += 1;
            }
        }
    }
    let mean = total / count as f64;
    println!("tracker 20 dB SNR: mean {mean:.4} cents, worst {worst:.4} cents");
    assert!(worst <= 8.0, "worst {worst:.3} cents");
    assert!(mean <= 2.0, "mean {mean:.3} cents");
}

#[test]
fn harmonic_signal_in_noise_at_10_db_has_no_octave_errors() {
    let harmonics = sawtooth_harmonics(12);
    for sr in RATES {
        for midi in (LOW_MIDI..=HIGH_MIDI).step_by(4) {
            let f = midi_to_hz(midi as f64);
            let mut signal = synth(sr, FRAME * 4, 0.3, &harmonics, |_| f);
            add_noise(&mut signal, 10.0, 99 + midi as u64);
            let err = detector_error(sr, &signal, f);
            assert!(err <= 15.0, "10 dB {f:.2} Hz at {sr}: {err:.3} cents");
        }
    }
}

#[test]
fn clipped_sine_is_detected() {
    for sr in RATES {
        for f in [98.0, 196.0, 440.0, 880.0] {
            let signal: Vec<f32> = sine(sr, FRAME * 4, 3.0, f)
                .into_iter()
                .map(|v| v.clamp(-1.0, 1.0))
                .collect();
            let err = detector_error(sr, &signal, f);
            assert!(err <= 3.0, "clipped {f} Hz at {sr}: {err:.3} cents");
        }
    }
}

#[test]
fn dc_offset_does_not_matter() {
    let signal: Vec<f32> = sine(48000.0, FRAME * 4, 0.3, 261.63)
        .iter()
        .map(|v| v + 0.4)
        .collect();
    assert!(detector_error(48000.0, &signal, 261.63) <= 3.0);
}

#[test]
fn detector_rejects_silence_nan_and_wrong_length() {
    let mut mpm = Mpm::new(48000.0, FRAME);
    assert!(mpm.detect(&[0.0; FRAME]).is_none());
    assert!(mpm.detect(&[0.25; FRAME]).is_none(), "pure DC is unpitched");

    let mut frame = sine(48000.0, FRAME, 0.5, 440.0);
    assert!(mpm.detect(&frame).is_some());
    frame[100] = f32::NAN;
    assert!(mpm.detect(&frame).is_none());
    frame[100] = f32::INFINITY;
    assert!(mpm.detect(&frame).is_none());
    frame[100] = f32::NEG_INFINITY;
    assert!(mpm.detect(&frame).is_none());

    let good = sine(48000.0, FRAME * 2, 0.5, 440.0);
    assert!(mpm.detect(&good[..FRAME - 1]).is_none());
    assert!(mpm.detect(&good[..FRAME + 1]).is_none());
    assert!(mpm.detect(&[]).is_none());
}

#[test]
fn detector_survives_garbage() {
    let mut mpm = Mpm::new(44100.0, FRAME);
    let mut rng = Rng(12345);
    for round in 0..50 {
        let scale = [1e-30, 1e-6, 1.0, 1e6, f32::MAX as f64][round % 5];
        let frame: Vec<f32> = (0..FRAME)
            .map(|_| ((rng.uniform() * 2.0 - 1.0) * scale) as f32)
            .collect();
        if let Some(est) = mpm.detect(&frame) {
            assert!(est.frequency_hz.is_finite() && est.frequency_hz > 0.0);
            assert!((0.0..=1.0).contains(&est.clarity));
        }
    }
    let mut impulses = [0.0f32; FRAME];
    impulses[0] = 1.0;
    let _ = mpm.detect(&impulses);
    let alternating: Vec<f32> = (0..FRAME)
        .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
        .collect();
    let _ = mpm.detect(&alternating);
}

// ----------------------------------------------------------------- tracker

#[test]
fn tracker_reports_note_and_cents_for_steady_sine() {
    for sr in RATES {
        for midi in (LOW_MIDI..=HIGH_MIDI).step_by(5) {
            for offset in [0.0, 0.18, -0.27] {
                let f = midi_to_hz(midi as f64 + offset);
                let signal = sine(sr, (sr * 0.5) as usize, 0.3, f);
                let mut tracker = new_tracker(sr);
                let out = track(&mut tracker, &signal, 440.0);
                assert!(
                    out.iter().all(Option::is_some),
                    "{f:.2} Hz at {sr} has gaps"
                );
                for p in out.iter().flatten() {
                    assert_eq!(p.stable_midi, midi, "{f:.2} Hz at {sr}");
                    assert!(
                        (p.cents - offset as f32 * 100.0).abs() <= 3.0,
                        "cents {}",
                        p.cents
                    );
                    assert!((p.midi - (midi as f64 + offset) as f32).abs() <= 0.03);
                    assert!(cents_between(p.frequency_hz as f64, f).abs() <= 3.0);
                    assert!(p.rms > 0.2 && p.rms < 0.22, "rms {}", p.rms);
                    assert!(p.clarity > 0.9);
                }
            }
        }
    }
}

#[test]
fn tracker_respects_a4_reference() {
    let sr = 48000.0;
    let signal = sine(sr, 24000, 0.3, 442.0);
    let mut tracker = new_tracker(sr);
    let last = track(&mut tracker, &signal, 442.0)
        .into_iter()
        .flatten()
        .last()
        .expect("pitch");
    assert_eq!(last.stable_midi, 69);
    assert!(last.cents.abs() < 1.0, "{}", last.cents);
    assert!((last.frequency_hz - 442.0).abs() < 0.5);

    // Same signal against A4 = 440 reads about +7.85 cents.
    let mut tracker = new_tracker(sr);
    let last = track(&mut tracker, &signal, 440.0)
        .into_iter()
        .flatten()
        .last()
        .expect("pitch");
    assert_eq!(last.stable_midi, 69);
    assert!((last.cents - 7.85).abs() < 1.0, "{}", last.cents);
}

#[test]
fn tracker_handles_harmonic_rich_voice_like_signal() {
    let harmonics = [0.3, 1.0, 0.7, 0.5, 0.4, 0.2, 0.15, 0.1];
    for sr in RATES {
        for midi in (LOW_MIDI..=HIGH_MIDI).step_by(4) {
            let f = midi_to_hz(midi as f64);
            let mut signal = synth(sr, (sr * 0.5) as usize, 0.3, &harmonics, |_| f);
            add_noise(&mut signal, 25.0, midi as u64);
            let mut tracker = new_tracker(sr);
            let notes = stable_notes(&track(&mut tracker, &signal, 440.0));
            assert!(notes.len() > 30, "too few estimates at {f:.2} Hz");
            assert!(
                notes.iter().all(|&n| n == midi),
                "{f:.2} Hz at {sr}: {notes:?}"
            );
        }
    }
}

#[test]
fn tracker_returns_none_for_silence_and_very_low_level() {
    for sr in RATES {
        let mut tracker = new_tracker(sr);
        let silence = vec![0.0f32; 20000];
        assert!(track(&mut tracker, &silence, 440.0)
            .iter()
            .all(Option::is_none));

        // -70 dBFS sine is below the default RMS gate.
        let quiet = sine(sr, 20000, 3e-4, 220.0);
        assert!(track(&mut tracker, &quiet, 440.0)
            .iter()
            .all(Option::is_none));
    }
}

#[test]
fn tracker_returns_none_for_pure_noise() {
    let mut noise = vec![0.0f32; 48000];
    let mut rng = Rng(7);
    for v in noise.iter_mut() {
        *v = (0.1 * rng.gauss()) as f32;
    }
    let mut tracker = new_tracker(48000.0);
    let out = track(&mut tracker, &noise, 440.0);
    let pitched = out.iter().filter(|p| p.is_some()).count();
    assert_eq!(pitched, 0, "white noise produced {pitched} pitched frames");
}

#[test]
fn tracker_rejects_out_of_range_frequencies() {
    let sr = 48000.0;
    for f in [55.0, 1800.0] {
        let signal = sine(sr, 24000, 0.3, f);
        let mut tracker = new_tracker(sr);
        assert!(
            track(&mut tracker, &signal, 440.0)
                .iter()
                .all(Option::is_none),
            "{f} Hz"
        );
    }
}

#[test]
fn tracker_rejects_nan_wrong_length_and_bad_a4() {
    let sr = 48000.0;
    let mut tracker = new_tracker(sr);
    let mut frame = sine(sr, FRAME, 0.3, 330.0);
    assert!(tracker.process(&frame, 440.0).is_some());
    assert!(tracker.process(&frame, f32::NAN).is_none());
    assert!(tracker.process(&frame, 0.0).is_none());
    assert!(tracker.process(&frame, -440.0).is_none());
    assert!(tracker.process(&frame, f32::INFINITY).is_none());
    assert!(tracker.process(&frame[..FRAME / 2], 440.0).is_none());
    assert!(tracker.process(&[], 440.0).is_none());
    frame[7] = f32::NAN;
    assert!(tracker.process(&frame, 440.0).is_none());
    let all_nan = [f32::NAN; FRAME];
    assert!(tracker.process(&all_nan, 440.0).is_none());
}

#[test]
fn vibrato_does_not_flicker_stable_midi() {
    for sr in RATES {
        for midi in [45, 57, 64, 69, 76] {
            // Centered on the note and pulled sharp / flat by 15 cents.
            for center_offset in [0.0, 0.15, -0.15] {
                let center = midi as f64 + center_offset;
                let signal = synth(sr, (sr * 3.0) as usize, 0.3, &[1.0, 0.6, 0.3], |t| {
                    midi_to_hz(center + 0.4 * (TAU * 5.5 * t).sin())
                });
                let mut tracker = new_tracker(sr);
                let out = track(&mut tracker, &signal, 440.0);
                let notes = stable_notes(&out);
                assert!(notes.len() as f64 > 0.95 * out.len() as f64);
                assert!(
                    notes.iter().all(|&n| n == midi),
                    "vibrato on {midi}{center_offset:+} at {sr}: {notes:?}"
                );
                // The raw midi still follows the vibrato.
                let span = out
                    .iter()
                    .flatten()
                    .map(|p| p.midi)
                    .fold((f32::MAX, f32::MIN), |(lo, hi), m| (lo.min(m), hi.max(m)));
                assert!(span.1 - span.0 > 0.5, "vibrato smoothed away: {span:?}");
            }
        }
    }
}

#[test]
fn slow_glide_switches_once() {
    for sr in RATES {
        for (from, to) in [(60.0, 61.0), (61.0, 60.0), (47.0, 48.0)] {
            // Hold 0.5 s, glide 2 s, hold 0.5 s.
            let signal = synth(sr, (sr * 3.0) as usize, 0.3, &[1.0, 0.5], |t| {
                let p = ((t - 0.5) / 2.0).clamp(0.0, 1.0);
                midi_to_hz(from + (to - from) * p)
            });
            let mut tracker = new_tracker(sr);
            let notes = stable_notes(&track(&mut tracker, &signal, 440.0));
            assert_eq!(notes.first(), Some(&(from as i32)));
            assert_eq!(notes.last(), Some(&(to as i32)));
            assert_eq!(
                count_switches(&notes),
                1,
                "glide {from}->{to} at {sr}: {notes:?}"
            );
        }
    }
}

#[test]
fn slow_glide_with_vibrato_switches_once_per_semitone() {
    let sr = 48000.0;
    let signal = synth(sr, (sr * 5.0) as usize, 0.3, &[1.0, 0.5, 0.25], |t| {
        let p = ((t - 0.5) / 4.0).clamp(0.0, 1.0);
        midi_to_hz(57.0 + 2.0 * p + 0.2 * (TAU * 5.5 * t).sin())
    });
    let mut tracker = new_tracker(sr);
    let notes = stable_notes(&track(&mut tracker, &signal, 440.0));
    assert_eq!(notes.first(), Some(&57));
    assert_eq!(notes.last(), Some(&59));
    assert_eq!(count_switches(&notes), 2, "{notes:?}");
}

#[test]
fn short_octave_errors_are_suppressed() {
    let sr = 48000.0;
    let f = 196.0; // G3
    let base: Vec<f32> = sine(sr, FRAME, 0.3, f);
    let up: Vec<f32> = sine(sr, FRAME, 0.3, 2.0 * f);
    let down: Vec<f32> = sine(sr, FRAME, 0.3, f / 2.0);
    let mut tracker = new_tracker(sr);
    let mut outputs = Vec::new();
    for _ in 0..10 {
        outputs.push(tracker.process(&base, 440.0));
    }
    for glitch in [&up, &down] {
        for burst in 1..=3 {
            for _ in 0..burst {
                outputs.push(tracker.process(glitch, 440.0));
            }
            for _ in 0..8 {
                outputs.push(tracker.process(&base, 440.0));
            }
        }
    }
    for p in outputs.iter() {
        let p = p.expect("pitched");
        assert_eq!(p.stable_midi, 55);
        assert!(
            p.cents.abs() < 3.0,
            "octave glitch leaked: {} cents",
            p.cents
        );
    }
}

#[test]
fn sustained_octave_jump_is_accepted() {
    let sr = 48000.0;
    let base = sine(sr, FRAME, 0.3, 220.0);
    let up = sine(sr, FRAME, 0.3, 440.0);
    let mut tracker = new_tracker(sr);
    for _ in 0..10 {
        assert_eq!(tracker.process(&base, 440.0).unwrap().stable_midi, 57);
    }
    let notes: Vec<i32> = (0..12)
        .map(|_| tracker.process(&up, 440.0).unwrap().stable_midi)
        .collect();
    let first_switch = notes.iter().position(|&n| n == 69).expect("never switched");
    assert!(first_switch <= 5, "switched too late: {notes:?}");
    assert!(notes[first_switch..].iter().all(|&n| n == 69), "{notes:?}");
    assert!(notes[..first_switch].iter().all(|&n| n == 57), "{notes:?}");
}

#[test]
fn ordinary_leaps_are_followed_quickly() {
    let sr = 48000.0;
    let a = sine(sr, FRAME, 0.3, midi_to_hz(60.0));
    let b = sine(sr, FRAME, 0.3, midi_to_hz(67.0));
    let mut tracker = new_tracker(sr);
    for _ in 0..10 {
        tracker.process(&a, 440.0);
    }
    let notes: Vec<i32> = (0..6)
        .map(|_| tracker.process(&b, 440.0).unwrap().stable_midi)
        .collect();
    // A median of 5 needs 3 new frames to flip.
    assert_eq!(notes[2..], [67, 67, 67, 67], "{notes:?}");
}

#[test]
fn reset_clears_history_and_hysteresis() {
    let sr = 48000.0;
    let a = sine(sr, FRAME, 0.3, midi_to_hz(60.0));
    // 60.65 is inside the hysteresis band of 60 (switch at 60.8) but rounds to 61.
    let b = sine(sr, FRAME, 0.3, midi_to_hz(60.65));

    let mut tracker = new_tracker(sr);
    for _ in 0..10 {
        tracker.process(&a, 440.0);
    }
    for _ in 0..10 {
        let p = tracker.process(&b, 440.0).unwrap();
        assert_eq!(p.stable_midi, 60);
        assert!((p.cents - 65.0).abs() < 3.0 || p.cents.abs() < 3.0);
    }

    tracker.process(&a, 440.0);
    tracker.reset();
    let p = tracker.process(&b, 440.0).unwrap();
    assert_eq!(p.stable_midi, 61, "hysteresis survived reset");
    assert!(
        (p.midi - 60.65).abs() < 0.03,
        "history survived reset: {}",
        p.midi
    );
    assert!((p.cents + 35.0).abs() < 3.0, "{}", p.cents);
}

#[test]
fn pause_between_notes_drops_old_history() {
    let sr = 48000.0;
    let a = sine(sr, FRAME, 0.3, midi_to_hz(60.0));
    let b = sine(sr, FRAME, 0.3, midi_to_hz(60.65));
    let silence = [0.0f32; FRAME];
    let mut tracker = new_tracker(sr);
    for _ in 0..10 {
        tracker.process(&a, 440.0);
    }
    for _ in 0..10 {
        assert!(tracker.process(&silence, 440.0).is_none());
    }
    let p = tracker.process(&b, 440.0).unwrap();
    assert_eq!(p.stable_midi, 61);
    assert!((p.midi - 60.65).abs() < 0.03);
}

#[test]
fn a_single_dropout_keeps_smoothing_state() {
    let sr = 48000.0;
    let a = sine(sr, FRAME, 0.3, midi_to_hz(60.0));
    let b = sine(sr, FRAME, 0.3, midi_to_hz(60.65));
    let silence = [0.0f32; FRAME];
    let mut tracker = new_tracker(sr);
    for _ in 0..10 {
        tracker.process(&a, 440.0);
    }
    for _ in 0..5 {
        tracker.process(&b, 440.0);
    }
    assert!(tracker.process(&silence, 440.0).is_none());
    assert_eq!(tracker.process(&b, 440.0).unwrap().stable_midi, 60);
}

#[test]
fn tracker_survives_odd_configs() {
    let configs = [
        TrackerConfig {
            median_window: 0,
            ..TrackerConfig::default()
        },
        TrackerConfig {
            median_window: 4,
            ..TrackerConfig::default()
        },
        TrackerConfig {
            median_window: usize::MAX,
            ..TrackerConfig::default()
        },
        TrackerConfig {
            hysteresis_cents: f32::NAN,
            ..TrackerConfig::default()
        },
        TrackerConfig {
            hysteresis_cents: -50.0,
            ..TrackerConfig::default()
        },
        TrackerConfig {
            clarity_threshold: f32::NAN,
            rms_threshold: f32::NAN,
            ..TrackerConfig::default()
        },
        TrackerConfig {
            min_hz: 2000.0,
            max_hz: 10.0,
            ..TrackerConfig::default()
        },
    ];
    let signal = synth(48000.0, 24000, 0.3, &[1.0, 0.5], |t| {
        midi_to_hz(62.0 + 0.4 * (TAU * 5.5 * t).sin())
    });
    for config in configs {
        let mut tracker = PitchTracker::new(48000.0, FRAME, config);
        let _ = track(&mut tracker, &signal, 440.0);
        tracker.reset();
        let _ = track(&mut tracker, &signal, 440.0);
    }
    for (sr, frame) in [(0.0, FRAME), (f32::NAN, FRAME), (48000.0, 0), (48000.0, 3)] {
        let mut tracker = PitchTracker::new(sr, frame, TrackerConfig::default());
        assert!(tracker.process(&signal[..frame], 440.0).is_none());
    }
}

//! The short analysis window (the newest half of the frame, used for higher
//! pitches) on synthetic signals. See "Short window" in `core/src/pitch`.

use ktone_core::pitch::{PitchTracker, TrackedPitch, TrackerConfig};
use std::f64::consts::TAU;

const FRAME: usize = 2048;
const HOP: usize = 512;
const RATES: [f64; 2] = [44100.0, 48000.0];
const VOICE: [f64; 4] = [1.0, 0.6, 0.3, 0.15];

fn midi_to_hz(midi: f64) -> f64 {
    440.0 * ((midi - 69.0) / 12.0).exp2()
}

/// Voice-like tone; `pitch(t)` in MIDI.
fn synth(sr: f64, seconds: f64, harmonics: &[f64], pitch: impl Fn(f64) -> f64) -> Vec<f32> {
    let norm: f64 = harmonics.iter().sum();
    let mut phase = 0.4;
    (0..(sr * seconds) as usize)
        .map(|i| {
            let f = midi_to_hz(pitch(i as f64 / sr));
            let s: f64 = harmonics
                .iter()
                .enumerate()
                .filter(|(k, _)| f * (*k as f64 + 1.0) < sr / 2.0)
                .map(|(k, a)| a * ((k as f64 + 1.0) * phase).sin())
                .sum();
            phase = (phase + TAU * f / sr) % (TAU * 64.0);
            (0.3 * s / norm) as f32
        })
        .collect()
}

/// `(frame end in seconds, output)` for every hop.
fn track(t: &mut PitchTracker, sr: f64, signal: &[f32]) -> Vec<(f64, Option<TrackedPitch>)> {
    signal
        .windows(FRAME)
        .step_by(HOP)
        .enumerate()
        .map(|(i, f)| ((i * HOP + FRAME) as f64 / sr, t.process(f, 440.0)))
        .collect()
}

#[test]
fn short_window_tracks_the_same_pitch_as_the_full_frame() {
    for sr in RATES {
        for midi in [57.0, 64.0, 69.0, 76.0, 84.0] {
            let signal = synth(sr, 1.0, &VOICE, |t| midi + 0.3 * (TAU * 5.5 * t).sin());
            let config = TrackerConfig::for_hop(sr as f32, HOP);
            let mut short = PitchTracker::new(sr as f32, FRAME, config);
            let mut full = PitchTracker::new(
                sr as f32,
                FRAME,
                TrackerConfig {
                    short_window: false,
                    ..config
                },
            );
            let a = track(&mut short, sr, &signal);
            let b = track(&mut full, sr, &signal);
            for ((_, p), (_, q)) in a.iter().zip(&b).skip(10) {
                let (p, q) = (p.expect("pitched"), q.expect("pitched"));
                assert_eq!(p.stable_midi, midi as i32);
                assert_eq!(q.stable_midi, midi as i32);
                // The short window lags less, so it differs on a moving pitch.
                assert!(
                    (p.midi - q.midi).abs() < 0.15,
                    "{midi} at {sr}: {} vs {}",
                    p.midi,
                    q.midi
                );
            }
        }
    }
}

#[test]
fn leaps_out_of_the_short_window_range_have_no_octave_errors() {
    // From a high note (short window) to a low one it cannot see, and back:
    // the full frame takes over. Strong second harmonic, so an octave-up is
    // tempting.
    let harmonics = [0.6, 1.0, 0.4, 0.3];
    for sr in RATES {
        for (from, to) in [
            (69.0, 40.0),
            (67.0, 45.0),
            (72.0, 52.0),
            (64.0, 57.0),
            (45.0, 69.0),
        ] {
            let signal = synth(sr, 1.6, &harmonics, |t| if t < 0.8 { from } else { to });
            let mut t = PitchTracker::new(sr as f32, FRAME, TrackerConfig::for_hop(sr as f32, HOP));
            let out = track(&mut t, sr, &signal);
            // Frames that straddle the leap may be unpitched.
            for (time, p) in out.iter().filter(|(t, _)| *t <= 0.8 || *t >= 0.95) {
                let p = p.unwrap_or_else(|| panic!("{from}->{to} at {sr}: unpitched at {time}"));
                let expected = if *time <= 0.8 { from } else { to };
                assert_eq!(p.stable_midi, expected as i32, "{from}->{to} at {sr}");
                assert!((p.midi as f64 - expected).abs() < 0.1, "{}", p.midi);
            }
        }
    }
}

//! Note switching (`stable_midi`) on synthetic signals. See "Note switching"
//! in `core/src/pitch`.

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
fn synth(sr: f64, seconds: f64, pitch: impl Fn(f64) -> f64) -> Vec<f32> {
    let norm: f64 = VOICE.iter().sum();
    let mut phase = 0.4;
    (0..(sr * seconds) as usize)
        .map(|i| {
            let f = midi_to_hz(pitch(i as f64 / sr));
            let s: f64 = VOICE
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

/// `(frame end in seconds, output)` for every hop, default tracker.
fn track(sr: f64, signal: &[f32]) -> Vec<(f64, Option<TrackedPitch>)> {
    let mut t = PitchTracker::new(sr as f32, FRAME, TrackerConfig::for_hop(sr as f32, HOP));
    signal
        .windows(FRAME)
        .step_by(HOP)
        .enumerate()
        .map(|(i, f)| ((i * HOP + FRAME) as f64 / sr, t.process(f, 440.0)))
        .collect()
}

fn notes(out: &[(f64, Option<TrackedPitch>)], from: f64, to: f64) -> Vec<i32> {
    out.iter()
        .filter(|(t, _)| *t >= from && *t <= to)
        .filter_map(|(_, p)| p.map(|p| p.stable_midi))
        .collect()
}

#[test]
fn wide_vibrato_never_switches_the_note() {
    // Troughs and crests up to 90 cents from the note, centered on it or
    // pulled 25 cents to one side, at usual vibrato rates.
    for sr in RATES {
        for (center, depth) in [(60.0, 0.9), (60.0, 0.75), (59.75, 0.6), (64.25, 0.6)] {
            for rate in [4.5, 5.5, 6.5] {
                let signal = synth(sr, 3.0, |t| center + depth * (TAU * rate * t).sin());
                let out = track(sr, &signal);
                let shown = notes(&out, 0.3, 3.0);
                let note = center.round() as i32;
                assert!(
                    shown.iter().all(|&n| n == note),
                    "{center} ±{depth} at {rate} Hz, {sr}: {shown:?}"
                );
            }
        }
    }
}

#[test]
fn a_steady_pitch_past_the_midpoint_is_shown_as_the_neighbor() {
    // 65 cents above C4 is C♯4 -35: within the hysteresis band, so the
    // display first stays on C4, but once the center has moved there too it
    // follows.
    for sr in RATES {
        let signal = synth(sr, 2.0, |t| if t < 0.8 { 60.0 } else { 60.65 });
        let out = track(sr, &signal);
        assert!(notes(&out, 0.3, 0.9).iter().all(|&n| n == 60));
        let late = notes(&out, 1.3, 2.0);
        assert!(late.iter().all(|&n| n == 61), "{sr}: {late:?}");
        let first = out
            .iter()
            .find(|(_, p)| p.is_some_and(|p| p.stable_midi == 61))
            .map(|(t, _)| t - 0.8)
            .expect("never switched");
        assert!(
            (0.1..=0.4).contains(&first),
            "{sr}: switched {first:.3} s after the change"
        );
    }
}

#[test]
fn a_note_reached_through_a_passing_one_is_shown_promptly() {
    // G3 glides up and settles 35 cents flat of A3, passing G♯3 on the way
    // (like the baritone scale in pitch_voice.rs).
    for sr in RATES {
        let signal = synth(sr, 1.6, |t| {
            let p = ((t - 0.8) / 0.12).clamp(0.0, 1.0);
            55.0 + 1.65 * p
        });
        let out = track(sr, &signal);
        let shown = notes(&out, 0.92 + 0.09, 1.6);
        assert!(shown.iter().all(|&n| n == 57), "{sr}: {shown:?}");
    }
}

#[test]
fn a_semitone_step_after_a_vibrato_is_followed() {
    for sr in RATES {
        let signal = synth(sr, 2.0, |t| {
            let base = if t < 1.0 { 62.0 } else { 63.0 };
            base + 0.4 * (TAU * 5.5 * t).sin()
        });
        let out = track(sr, &signal);
        assert!(notes(&out, 0.3, 1.0).iter().all(|&n| n == 62));
        let after = notes(&out, 1.15, 2.0);
        assert!(after.iter().all(|&n| n == 63), "{sr}: {after:?}");
    }
}

#[test]
fn a_straight_semitone_step_is_followed_at_once() {
    // A settled, steady note: the step is shown on the first frame past the
    // hysteresis band, without the dwell.
    for sr in RATES {
        for (from, to) in [(57.0, 58.0), (64.0, 63.0)] {
            let signal = synth(sr, 1.6, |t| if t < 0.8 { from } else { to });
            let out = track(sr, &signal);
            let past_band = out
                .iter()
                .position(|(_, p)| p.is_some_and(|p| (p.midi as f64 - from).abs() > 0.8))
                .expect("never past the band");
            let shown = out[past_band].1.unwrap().stable_midi;
            assert_eq!(shown, to as i32, "{from}->{to} at {sr}");
            assert!(notes(&out, out[past_band].0, 1.6)
                .iter()
                .all(|&n| n == to as i32));
        }
    }
}

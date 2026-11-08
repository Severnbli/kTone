//! Vibrato center (`TrackedPitch::center_midi` / `center_cents`).
//!
//! Accuracy is judged by the center of the vibrato, so a steady note sung with
//! a wide vibrato must stay in the green zone while the raw pitch still swings.

use ktone_core::pitch::{PitchTracker, TrackedPitch, TrackerConfig};
use std::f64::consts::TAU;

const FRAME: usize = 2048;
const HOP: usize = 512;
const RATES: [f64; 2] = [44100.0, 48000.0];
/// Default green zone (cents).
const GREEN: f32 = 10.0;

fn midi_to_hz(midi: f64) -> f64 {
    440.0 * ((midi - 69.0) / 12.0).exp2()
}

/// Phase-accumulating oscillator with a few harmonics; `pitch(t)` is in MIDI.
fn synth(sr: f64, seconds: f64, pitch: impl Fn(f64) -> f64) -> Vec<f32> {
    let harmonics = [1.0, 0.6, 0.3];
    let norm: f64 = harmonics.iter().sum();
    let mut phase = 0.1;
    (0..(sr * seconds) as usize)
        .map(|i| {
            let f = midi_to_hz(pitch(i as f64 / sr));
            let s: f64 = harmonics
                .iter()
                .enumerate()
                .map(|(k, a)| a * ((k + 1) as f64 * phase).sin())
                .sum();
            phase = (phase + TAU * f / sr) % (TAU * 64.0);
            (0.3 * s / norm) as f32
        })
        .collect()
}

/// Tracker for the given rate with the center window sized for the hop.
fn new_tracker(sr: f64) -> PitchTracker {
    let config = TrackerConfig::for_hop(sr as f32, HOP);
    PitchTracker::new(sr as f32, FRAME, config)
}

/// `(end time of the frame in seconds, output)` for every hop.
fn track(tracker: &mut PitchTracker, sr: f64, signal: &[f32]) -> Vec<(f64, Option<TrackedPitch>)> {
    signal
        .windows(FRAME)
        .step_by(HOP)
        .enumerate()
        .map(|(i, frame)| {
            let end = (i * HOP + FRAME) as f64 / sr;
            (end, tracker.process(frame, 440.0))
        })
        .collect()
}

fn vibrato(center: f64, depth_semitones: f64, rate_hz: f64) -> impl Fn(f64) -> f64 {
    move |t| center + depth_semitones * (TAU * rate_hz * t).sin()
}

/// Frames whose analysis window ends after `warm_up` seconds.
fn after(out: &[(f64, Option<TrackedPitch>)], warm_up: f64) -> Vec<TrackedPitch> {
    out.iter()
        .filter(|(t, _)| *t >= warm_up)
        .map(|(_, p)| p.expect("pitched"))
        .collect()
}

#[test]
fn default_window_covers_about_300_ms() {
    for sr in RATES {
        let frames = TrackerConfig::for_hop(sr as f32, HOP).center_window;
        let seconds = frames as f64 * HOP as f64 / sr;
        assert!((0.28..=0.32).contains(&seconds), "{frames} frames at {sr}");
    }
    let d = TrackerConfig::default().center_window;
    assert_eq!(d, TrackerConfig::for_hop(48000.0, 512).center_window);
}

#[test]
fn centered_vibrato_stays_green() {
    for sr in RATES {
        for midi in [45.0, 57.0, 69.0, 76.0] {
            for rate in [4.5, 5.5, 6.5] {
                let signal = synth(sr, 3.0, vibrato(midi, 0.4, rate));
                let mut tracker = new_tracker(sr);
                let frames = after(&track(&mut tracker, sr, &signal), 0.5);
                let worst = frames
                    .iter()
                    .map(|p| p.center_cents.abs())
                    .fold(0.0, f32::max);
                assert!(
                    worst <= 6.0,
                    "center off by {worst} cents ({midi} at {rate} Hz, {sr})"
                );
                assert!(frames.iter().all(|p| p.center_cents.abs() <= GREEN));
                assert!(frames.iter().all(|p| p.stable_midi == midi as i32));
                for p in &frames {
                    let expected = (p.center_midi - p.stable_midi as f32) * 100.0;
                    assert!((p.center_cents - expected).abs() < 0.01);
                }
                // The raw (per-frame) cents still show the vibrato.
                let lo = frames.iter().map(|p| p.cents).fold(f32::MAX, f32::min);
                let hi = frames.iter().map(|p| p.cents).fold(f32::MIN, f32::max);
                assert!(lo < -30.0 && hi > 30.0, "raw swing {lo}..{hi}");
            }
        }
    }
}

#[test]
fn off_center_vibrato_reports_the_offset() {
    for sr in RATES {
        for offset in [0.2, -0.2] {
            let signal = synth(sr, 3.0, vibrato(60.0 + offset, 0.4, 5.5));
            let mut tracker = new_tracker(sr);
            let frames = after(&track(&mut tracker, sr, &signal), 0.5);
            let target = (offset * 100.0) as f32;
            for p in &frames {
                assert_eq!(p.stable_midi, 60);
                assert!(
                    (p.center_cents - target).abs() <= 6.0,
                    "center {} for {target} at {sr}",
                    p.center_cents
                );
            }
        }
    }
}

#[test]
fn center_follows_a_leap_quickly() {
    for sr in RATES {
        for (from, to) in [(60.0, 64.0), (64.0, 59.0), (57.0, 62.0)] {
            let leap = 1.0;
            let signal = synth(sr, 2.0, |t| if t < leap { from } else { to });
            let mut tracker = new_tracker(sr);
            let out = track(&mut tracker, sr, &signal);
            // Frames ending this long after the leap must show the new note centered.
            let settled = after(&out, leap + 0.12);
            for p in &settled {
                assert_eq!(p.stable_midi, to as i32);
                assert!(
                    p.center_cents.abs() <= 3.0,
                    "{from}->{to} at {sr}: center {} cents",
                    p.center_cents
                );
            }
        }
    }
}

#[test]
fn center_is_not_dragged_after_a_leap_with_vibrato() {
    let sr = 48000.0;
    let leap = 1.5;
    let signal = synth(sr, 3.0, |t| {
        let base = if t < leap { 57.0 } else { 62.0 };
        base + 0.4 * (TAU * 5.5 * t).sin()
    });
    let mut tracker = new_tracker(sr);
    let out = track(&mut tracker, sr, &signal);
    // Even while the window refills, the center never leans toward the old note
    // by more than the vibrato depth.
    for p in after(&out, leap + 0.06) {
        assert_eq!(p.stable_midi, 62);
        assert!(p.center_cents.abs() <= 40.0, "{}", p.center_cents);
    }
    for p in after(&out, leap + 0.45) {
        assert!(p.center_cents.abs() <= GREEN, "{}", p.center_cents);
    }
}

#[test]
fn gap_resets_the_center() {
    let sr = 48000.0;
    let a = synth(sr, 1.0, |_| 60.0);
    // 60.3: same stable note as 60, so only the gap can clear the history.
    let b = synth(sr, 0.2, |_| 60.3);
    let silence = vec![0.0f32; FRAME];
    let mut tracker = new_tracker(sr);
    track(&mut tracker, sr, &a);
    for _ in 0..10 {
        assert!(tracker.process(&silence, 440.0).is_none());
    }
    let p = tracker.process(&b[..FRAME], 440.0).expect("pitched");
    assert_eq!(p.stable_midi, 60);
    assert!(
        (p.center_cents - 30.0).abs() < 3.0,
        "old note leaked into the center: {}",
        p.center_cents
    );
}

#[test]
fn a_single_dropout_keeps_the_center() {
    let sr = 48000.0;
    let a = synth(sr, 1.0, |_| 60.0);
    let b = synth(sr, 0.2, |_| 60.3);
    let silence = vec![0.0f32; FRAME];
    let mut tracker = new_tracker(sr);
    track(&mut tracker, sr, &a);
    assert!(tracker.process(&silence, 440.0).is_none());
    let p = tracker.process(&b[..FRAME], 440.0).expect("pitched");
    assert!(p.center_cents < 10.0, "history dropped: {}", p.center_cents);
}

#[test]
fn reset_clears_the_center() {
    let sr = 48000.0;
    let a = synth(sr, 1.0, |_| 60.0);
    let b = synth(sr, 0.2, |_| 60.3);
    let mut tracker = new_tracker(sr);
    track(&mut tracker, sr, &a);
    tracker.reset();
    let p = tracker.process(&b[..FRAME], 440.0).expect("pitched");
    assert!((p.center_cents - 30.0).abs() < 3.0, "{}", p.center_cents);
}

#[test]
fn center_respects_a4_reference() {
    let sr = 48000.0;
    let signal = synth(sr, 1.0, |_| 69.0 + 12.0 * (442.0f64 / 440.0).log2());
    let mut tracker = new_tracker(sr);
    let p = signal
        .windows(FRAME)
        .step_by(HOP)
        .filter_map(|f| tracker.process(f, 442.0))
        .last()
        .expect("pitched");
    assert_eq!(p.stable_midi, 69);
    assert!((p.center_midi - 69.0).abs() < 0.03, "{}", p.center_midi);
    assert!(p.center_cents.abs() < 3.0);
}

#[test]
fn odd_center_windows_do_not_panic() {
    let signal = synth(48000.0, 0.5, vibrato(62.0, 0.4, 5.5));
    for center_window in [0, 1, 2, usize::MAX] {
        let config = TrackerConfig {
            center_window,
            ..TrackerConfig::default()
        };
        let mut tracker = PitchTracker::new(48000.0, FRAME, config);
        let out = track(&mut tracker, 48000.0, &signal);
        assert!(out
            .iter()
            .filter_map(|(_, p)| *p)
            .all(|p| p.center_cents.is_finite()));
    }
    // Nonsense rates and hops fall back to the default window.
    let d = TrackerConfig::default().center_window;
    assert_eq!(TrackerConfig::for_hop(f32::NAN, 512).center_window, d);
    assert_eq!(TrackerConfig::for_hop(48000.0, 0).center_window, d);
    assert_eq!(TrackerConfig::for_hop(-1.0, 512).center_window, d);
}

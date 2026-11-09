//! Algorithmic delay of the pitch tracker, measured in audio time.
//!
//! A synthetic voice steps from one note to another (phase-continuous, with
//! and without vibrato). Frames are taken every hop like the web app does; a
//! frame's result is available once its newest sample has arrived, so the
//! delay of a frame is `frame end - onset`. For each step and several hop
//! alignments the test reports how many milliseconds of audio after the onset
//! of the new note it takes until, for good (that frame and all later ones):
//!
//! - (a) `midi` is within 50 cents of the new note,
//! - (b) `stable_midi` is the new note,
//! - (c) `center_cents` is within ±10 cents of the new note.
//!
//! Run with `--nocapture` to see the table. The asserted bounds are recorded
//! in `docs/decisions.md`; buffering in the browser (input latency, message
//! passing, the next display frame) comes on top.

use ktone_core::pitch::{PitchTracker, TrackedPitch, TrackerConfig};
use std::f64::consts::TAU;

const FRAME: usize = 2048;
const HOP: usize = 512;
const SR: f64 = 48000.0;
/// Onset positions relative to the hop grid (samples).
const ALIGNMENTS: [usize; 4] = [0, 128, 256, 384];
/// Note held before the step, seconds.
const BEFORE: f64 = 1.0;
/// Note held after the step, seconds.
const AFTER: f64 = 0.8;
const VIBRATO_RATE: f64 = 5.5;
/// Vibrato depth in semitones (±35 cents).
const VIBRATO_DEPTH: f64 = 0.35;

/// Upper bounds (ms) on the worst case over the hop alignments of a step.
struct Bounds {
    midi: f64,
    stable: f64,
    center: f64,
}

fn bounds(c: &Case) -> Bounds {
    let octave = ((c.to - c.from).abs() - 12.0).abs() < 0.5;
    // The frame must be mostly filled with the new note, plus the median;
    // an octave leap waits for the octave guard.
    let base = if octave { 80.0 } else { 60.0 };
    Bounds {
        midi: base,
        // A step of a tone or less with vibrato: a trough of the new note (or
        // of a passing one) falls back inside the hysteresis band.
        stable: if c.vibrato && (c.to - c.from).abs() < 2.5 {
            150.0
        } else {
            base
        },
        // The center of a vibrato needs most of its 300 ms window.
        center: if c.vibrato { 300.0 } else { base },
    }
}

fn midi_to_hz(midi: f64) -> f64 {
    440.0 * ((midi - 69.0) / 12.0).exp2()
}

/// Voice-like tone with a few harmonics; `pitch(t)` in MIDI.
fn synth(len: usize, pitch: impl Fn(f64) -> f64) -> Vec<f32> {
    let harmonics = [1.0, 0.6, 0.3, 0.15];
    let norm: f64 = harmonics.iter().sum();
    let mut phase = 0.2;
    (0..len)
        .map(|i| {
            let f = midi_to_hz(pitch(i as f64 / SR));
            let s: f64 = harmonics
                .iter()
                .enumerate()
                .filter(|(k, _)| f * (*k as f64 + 1.0) < SR / 2.0)
                .map(|(k, a)| a * ((k as f64 + 1.0) * phase).sin())
                .sum();
            phase = (phase + TAU * f / SR) % (TAU * 64.0);
            (0.3 * s / norm) as f32
        })
        .collect()
}

#[derive(Clone, Copy)]
struct Case {
    name: &'static str,
    from: f64,
    to: f64,
    vibrato: bool,
}

const fn case(name: &'static str, from: f64, to: f64, vibrato: bool) -> Case {
    Case {
        name,
        from,
        to,
        vibrato,
    }
}

const CASES: [Case; 14] = [
    case("bass semitone up", 45.0, 46.0, false),
    case("bass fourth down", 50.0, 45.0, false),
    case("bass E2 -> G2", 40.0, 43.0, false),
    case("tenor semitone down", 60.0, 59.0, false),
    case("tenor third up", 57.0, 60.0, false),
    case("tenor fifth up", 55.0, 62.0, false),
    case("tenor octave up", 55.0, 67.0, false),
    case("soprano semitone up", 76.0, 77.0, false),
    case("soprano sixth down", 81.0, 72.0, false),
    case("bass semitone + vib", 45.0, 46.0, true),
    case("bass fifth + vib", 45.0, 52.0, true),
    case("tenor semitone + vib", 60.0, 61.0, true),
    case("tenor third + vib", 64.0, 60.0, true),
    case("soprano step + vib", 74.0, 76.0, true),
];

/// Delays (ms) of one run: (a) midi, (b) stable note, (c) center.
#[derive(Clone, Copy)]
struct Delays {
    midi: f64,
    stable: f64,
    center: f64,
}

/// Time (ms after the onset) of the first frame from which `ok` holds for
/// every later frame; `f64::INFINITY` when it never settles.
fn settle(frames: &[(f64, Option<TrackedPitch>)], ok: impl Fn(&TrackedPitch) -> bool) -> f64 {
    let mut first = None;
    for (i, (_, p)) in frames.iter().enumerate() {
        match p {
            Some(p) if ok(p) => {
                first.get_or_insert(i);
            }
            _ => first = None,
        }
    }
    first.map_or(f64::INFINITY, |i| frames[i].0 * 1000.0)
}

fn measure(c: Case, align: usize) -> Delays {
    // The onset lands `align` samples after a frame boundary of the hop grid.
    let onset_sample = (BEFORE * SR) as usize / HOP * HOP + align;
    let onset = onset_sample as f64 / SR;
    let len = onset_sample + (AFTER * SR) as usize;
    let signal = synth(len, |t| {
        let base = if t < onset { c.from } else { c.to };
        let vib = if c.vibrato {
            VIBRATO_DEPTH * (TAU * VIBRATO_RATE * t).sin()
        } else {
            0.0
        };
        base + vib
    });
    let mut tracker = PitchTracker::new(SR as f32, FRAME, TrackerConfig::for_hop(SR as f32, HOP));
    let frames: Vec<(f64, Option<TrackedPitch>)> = signal
        .windows(FRAME)
        .step_by(HOP)
        .enumerate()
        .map(|(i, f)| {
            let end = (i * HOP + FRAME) as f64 / SR;
            (end - onset, tracker.process(f, 440.0))
        })
        .filter(|(t, _)| *t > 0.0)
        .collect();
    let to = c.to;
    Delays {
        midi: settle(&frames, |p| (p.midi as f64 - to).abs() <= 0.5),
        stable: settle(&frames, |p| p.stable_midi == to as i32),
        center: settle(&frames, |p| {
            p.stable_midi == to as i32 && (p.center_midi as f64 - to).abs() * 100.0 <= 10.0
        }),
    }
}

#[test]
fn step_latency_table() {
    println!(
        "\n{:<22} {:>13} {:>13} {:>13}",
        "step (48 kHz)", "(a) midi", "(b) stable", "(c) center"
    );
    println!(
        "{:<22} {:>13} {:>13} {:>13}",
        "", "mean / max", "mean / max", "mean / max"
    );
    let mut failures = Vec::new();
    for c in CASES {
        let runs: Vec<Delays> = ALIGNMENTS.iter().map(|&a| measure(c, a)).collect();
        let stat = |f: fn(&Delays) -> f64| {
            let v: Vec<f64> = runs.iter().map(f).collect();
            let max = v.iter().cloned().fold(0.0, f64::max);
            (v.iter().sum::<f64>() / v.len() as f64, max)
        };
        let (m, s, ce) = (stat(|d| d.midi), stat(|d| d.stable), stat(|d| d.center));
        println!(
            "{:<22} {:>6.0} / {:>4.0} {:>6.0} / {:>4.0} {:>6.0} / {:>4.0}",
            c.name, m.0, m.1, s.0, s.1, ce.0, ce.1
        );
        let b = bounds(&c);
        for (what, got, max) in [
            ("midi", m.1, b.midi),
            ("stable note", s.1, b.stable),
            ("center", ce.1, b.center),
        ] {
            if got > max {
                failures.push(format!("{}: {what} after {got:.0} ms (> {max:.0})", c.name));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("; "));
}

//! Pitch tracking on real recorded singing (VocalSet, CC BY 4.0).
//!
//! Clips and their provenance are listed in `tests/fixtures/voice/SOURCES.md`.
//! Ground truth (note and median pitch of each sung note, time spans) was
//! established offline, independently of the detector under test: the note is
//! the one written in the VocalSet score (`DataSetVocalises.pdf`, transposed an
//! octave down for male singers), and the exact pitch and note boundaries come
//! from a long-window YIN analysis with a spectral harmonic check against
//! octave errors. The numbers below are copied from that analysis; nothing here
//! is derived from `PitchTracker` itself.

use ktone_core::pitch::{PitchTracker, TrackedPitch, TrackerConfig};
use std::path::PathBuf;

const FRAME: usize = 2048;
const HOP: usize = 512;
const A4: f32 = 440.0;

/// Share of voiced frames in a sustained span that must show the expected note.
const MIN_NOTE_SHARE: f64 = 0.9;
/// Share of frames in a sustained span that must be voiced at all.
const MIN_VOICED_SHARE: f64 = 0.8;
/// Allowed difference between the median tracked pitch and ground truth.
const MAX_MEDIAN_CENTS_ERROR: f64 = 10.0;

struct Clip {
    sample_rate: f32,
    samples: Vec<f32>,
}

fn load(name: &str) -> Clip {
    let path: PathBuf = [
        env!("CARGO_MANIFEST_DIR"),
        "tests",
        "fixtures",
        "voice",
        name,
    ]
    .iter()
    .collect();
    let mut reader =
        hound::WavReader::open(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    let spec = reader.spec();
    assert_eq!(spec.channels, 1, "{name}: fixtures are mono");
    assert_eq!(spec.bits_per_sample, 16, "{name}: fixtures are 16-bit");
    assert_eq!(spec.sample_format, hound::SampleFormat::Int);
    let samples = reader
        .samples::<i16>()
        .map(|s| s.expect("valid sample") as f32 / 32768.0)
        .collect();
    Clip {
        sample_rate: spec.sample_rate as f32,
        samples,
    }
}

/// One tracker output with the time span (seconds) of the frame it came from.
struct Frame {
    start: f64,
    end: f64,
    pitch: Option<TrackedPitch>,
}

/// Feeds the clip through a fresh default tracker, frame 2048 / hop 512.
fn track(clip: &Clip) -> Vec<Frame> {
    let mut tracker = PitchTracker::new(clip.sample_rate, FRAME, TrackerConfig::default());
    let sr = clip.sample_rate as f64;
    clip.samples
        .windows(FRAME)
        .step_by(HOP)
        .enumerate()
        .map(|(i, frame)| Frame {
            start: (i * HOP) as f64 / sr,
            end: (i * HOP + FRAME) as f64 / sr,
            pitch: tracker.process(frame, A4),
        })
        .collect()
}

/// Frames that lie entirely inside `[from, to]` seconds.
fn within(frames: &[Frame], from: f64, to: f64) -> Vec<&Frame> {
    frames
        .iter()
        .filter(|f| f.start >= from && f.end <= to)
        .collect()
}

fn median(values: &mut [f64]) -> f64 {
    assert!(!values.is_empty());
    values.sort_by(|a, b| a.total_cmp(b));
    let n = values.len();
    if n % 2 == 1 {
        values[n / 2]
    } else {
        0.5 * (values[n / 2 - 1] + values[n / 2])
    }
}

fn describe(frames: &[&Frame]) -> String {
    frames
        .iter()
        .map(|f| match f.pitch {
            Some(p) => format!("{}({:+.0})", p.stable_midi, p.cents),
            None => "-".to_string(),
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// Statistics of a sustained span against its ground truth.
struct Sustained {
    frames: usize,
    voiced: usize,
    on_note: usize,
    octave_errors: usize,
    switches: usize,
    median_midi: f64,
}

fn sustained(frames: &[&Frame], expected_note: i32, truth_midi: f64) -> Sustained {
    let voiced: Vec<TrackedPitch> = frames.iter().filter_map(|f| f.pitch).collect();
    let on_note = voiced
        .iter()
        .filter(|p| p.stable_midi == expected_note)
        .count();
    // Anything more than 6 semitones from the truth is a wrong octave (or worse).
    let octave_errors = voiced
        .iter()
        .filter(|p| (p.midi as f64 - truth_midi).abs() >= 6.0)
        .count();
    let switches = voiced
        .windows(2)
        .filter(|w| w[0].stable_midi != w[1].stable_midi)
        .count();
    let mut midis: Vec<f64> = voiced.iter().map(|p| p.midi as f64).collect();
    let median_midi = if midis.is_empty() {
        f64::NAN
    } else {
        median(&mut midis)
    };
    Sustained {
        frames: frames.len(),
        voiced: voiced.len(),
        on_note,
        octave_errors,
        switches,
        median_midi,
    }
}

/// Asserts the standard sustained-note expectations and returns the stats.
fn assert_sustained(
    clip: &str,
    frames: &[Frame],
    span: (f64, f64),
    expected_note: i32,
    truth_midi: f64,
) -> Sustained {
    let span_frames = within(frames, span.0, span.1);
    assert!(
        span_frames.len() >= 10,
        "{clip}: span too short ({} frames)",
        span_frames.len()
    );
    let s = sustained(&span_frames, expected_note, truth_midi);
    let detail = describe(&span_frames);
    println!(
        "{clip}: {} frames, {} voiced, {} on note {expected_note}, {} switches, median {:.3} (truth {truth_midi:.3})",
        s.frames, s.voiced, s.on_note, s.switches, s.median_midi
    );
    assert!(
        s.voiced as f64 >= MIN_VOICED_SHARE * s.frames as f64,
        "{clip}: only {}/{} frames voiced: {detail}",
        s.voiced,
        s.frames
    );
    assert!(
        s.on_note as f64 >= MIN_NOTE_SHARE * s.voiced as f64,
        "{clip}: only {}/{} voiced frames on note {expected_note}: {detail}",
        s.on_note,
        s.voiced
    );
    assert_eq!(s.octave_errors, 0, "{clip}: octave errors: {detail}");
    let cents_error = 100.0 * (s.median_midi - truth_midi);
    assert!(
        cents_error.abs() <= MAX_MEDIAN_CENTS_ERROR,
        "{clip}: median {:.3} vs truth {truth_midi:.3} ({cents_error:+.1} cents)",
        s.median_midi
    );
    s
}

fn assert_silent(clip: &str, frames: &[Frame], span: (f64, f64)) {
    let span_frames = within(frames, span.0, span.1);
    assert!(
        !span_frames.is_empty(),
        "{clip}: silent span {span:?} holds no full frame"
    );
    assert!(
        span_frames.iter().all(|f| f.pitch.is_none()),
        "{clip}: pitch reported in silence {span:?}: {}",
        describe(&span_frames)
    );
}

// ------------------------------------------------------------------ clips

/// Bass (VocalSet m8), long tone C3 in straight tone, sung about 21 cents flat.
/// Starts with ~0.39 s of room silence.
#[test]
fn bass_c3_straight_tone() {
    let name = "bass_c3_straight.wav";
    let frames = track(&load(name));
    assert_silent(name, &frames, (0.0, 0.37));
    let s = assert_sustained(name, &frames, (0.70, 2.15), 48, 47.792);
    assert_eq!(s.switches, 0, "{name}: displayed note flickers");
}

/// Soprano (VocalSet f2), long tone F5 in straight tone, about 31 cents sharp.
#[test]
fn soprano_f5_straight_tone() {
    let name = "soprano_f5_straight.wav";
    let frames = track(&load(name));
    let s = assert_sustained(name, &frames, (0.05, 1.95), 77, 77.309);
    assert_eq!(s.switches, 0, "{name}: displayed note flickers");
}

/// Sustained span of `bass_c4_vibrato.wav`.
const VIBRATO_SPAN: (f64, f64) = (0.25, 2.15);

/// Bass (VocalSet m8), forte long tone C4 with natural vibrato of about
/// ±50 cents at ~5 Hz, centred 5 cents flat: right note, right centre, no
/// octave errors.
#[test]
fn bass_c4_vibrato_note_and_centre() {
    let name = "bass_c4_vibrato.wav";
    let frames = track(&load(name));
    assert_sustained(name, &frames, VIBRATO_SPAN, 60, 59.951);
}

/// Same clip: the displayed note must not leave C4 during the vibrato. One
/// trough at ~1.81 s really dips to about 92 cents below C4 (offline YIN),
/// past the hysteresis band, while the vibrato centre stays at C4 -5 cents:
/// the trough only grazes the band for a few frames of a swinging note.
#[test]
fn bass_c4_vibrato_does_not_flicker() {
    let name = "bass_c4_vibrato.wav";
    let frames = track(&load(name));
    let span = within(&frames, VIBRATO_SPAN.0, VIBRATO_SPAN.1);
    let s = sustained(&span, 60, 59.951);
    assert_eq!(
        s.switches,
        0,
        "{name}: displayed note flickers: {}",
        describe(&span)
    );
}

/// Bass (VocalSet m4), "Dona nobis" excerpt: "no" on G3 after an /n/ onset, a
/// short scooped C3, then "bis" on B♭3 after a /b/ onset, then silence.
#[test]
fn consonant_onsets_and_held_note() {
    let name = "bass_dona_consonants.wav";
    let frames = track(&load(name));
    assert_silent(name, &frames, (0.0, 0.08));
    // "no" on G3 (0.085-0.300 s), attack skipped.
    assert_sustained(name, &frames, (0.13, 0.30), 55, 54.894);
    // "bis" on B♭3 (0.830-1.880 s), /b/ onset skipped.
    let s = assert_sustained(name, &frames, (0.885, 1.88), 58, 58.011);
    assert_eq!(s.switches, 0, "{name}: displayed note flickers on B♭3");
    assert_silent(name, &frames, (1.895, 2.065));
}

/// Notes of `baritone_scale_up.wav` as (start s, end s, MIDI note), from the
/// offline segmentation. C3 (0.08-0.23 s) is left out: it is sung 43 cents
/// flat after a scoop from B2, so either neighbor is a defensible display.
const SCALE: [(f64, f64, i32); 8] = [
    (0.260, 0.475, 50), // D3
    (0.525, 0.775, 52), // E3
    (0.775, 1.060, 53), // F3
    (1.120, 1.360, 55), // G3
    (1.445, 1.665, 57), // A3, 33 cents flat, reached through a passing G♯3
    (1.725, 2.000, 59), // B3
    (2.000, 2.290, 60), // C4
    (2.345, 2.620, 62), // D4
];

/// Baritone (VocalSet m5), ascending C major scale in straight tone, about
/// four notes per second: every note is displayed, in order, with no octave
/// errors.
#[test]
fn ascending_scale_notes_in_order() {
    let name = "baritone_scale_up.wav";
    let frames = track(&load(name));
    let voiced: Vec<TrackedPitch> = frames.iter().filter_map(|f| f.pitch).collect();
    for p in &voiced {
        assert!(
            (46.0..=64.0).contains(&p.midi),
            "{name}: pitch {:.2} is outside the sung range",
            p.midi
        );
    }
    // Displayed notes held for at least 3 frames (~35 ms).
    let mut runs: Vec<(i32, usize)> = Vec::new();
    for p in &voiced {
        match runs.last_mut() {
            Some((note, len)) if *note == p.stable_midi => *len += 1,
            _ => runs.push((p.stable_midi, 1)),
        }
    }
    let shown: Vec<i32> = runs
        .iter()
        .filter(|(_, len)| *len >= 3)
        .map(|(n, _)| *n)
        .collect();
    let mut expected = SCALE.iter().map(|&(_, _, n)| n).peekable();
    for n in &shown {
        if expected.peek() == Some(n) {
            expected.next();
        }
    }
    let missing: Vec<i32> = expected.collect();
    assert!(
        missing.is_empty(),
        "{name}: notes {missing:?} not shown in order; shown: {shown:?}"
    );
}

/// Same clip, stricter: each note is displayed for at least 80 % of its
/// settled frames. The flat A3 is the hard one: A3 -33 cents is only 67 cents
/// above the passing G♯3, inside the hysteresis band, so the display must
/// follow the center of the steady G♯3 there.
#[test]
fn ascending_scale_each_note_settles() {
    let name = "baritone_scale_up.wav";
    let frames = track(&load(name));
    let mut failures = Vec::new();
    for (start, end, note) in SCALE {
        // Frames centred in the note, after the tracker had time to settle.
        let settled: Vec<&Frame> = frames
            .iter()
            .filter(|f| {
                let centre = 0.5 * (f.start + f.end);
                centre >= start + 0.06 && centre <= end - 0.01
            })
            .collect();
        let shown = settled
            .iter()
            .filter(|f| f.pitch.is_some_and(|p| p.stable_midi == note))
            .count();
        if (shown as f64) < 0.8 * settled.len() as f64 {
            failures.push(format!(
                "note {note} at {start:.3}-{end:.3}: {shown}/{} [{}]",
                settled.len(),
                describe(&settled)
            ));
        }
    }
    assert!(failures.is_empty(), "{name}: {}", failures.join("; "));
}

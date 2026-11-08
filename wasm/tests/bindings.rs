use ktone_wasm::{all_keys, frame_fields, key_signature, Analyzer, FRAME_FIELDS};

const SR: f32 = 48_000.0;
const FRAME: usize = 2048;
const HOP: usize = 512;

fn sine(freq: f32, len: usize, offset: usize) -> Vec<f32> {
    (0..len)
        .map(|i| 0.5 * (2.0 * std::f32::consts::PI * freq * (i + offset) as f32 / SR).sin())
        .collect()
}

/// Feeds overlapping frames of a steady tone and returns the last output.
fn run(analyzer: &mut Analyzer, freq: f32) -> Option<Vec<f64>> {
    let mut out = vec![0.0; FRAME_FIELDS];
    let mut last = None;
    for hop in 0..20 {
        if analyzer.process(&sine(freq, FRAME, hop * HOP), &mut out) {
            last = Some(out.clone());
        }
    }
    last
}

#[test]
fn reports_frame_layout_size() {
    assert_eq!(frame_fields(), FRAME_FIELDS);
}

#[test]
fn detects_a4_in_c_major_treble() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    assert_eq!(a.frame_size(), FRAME);
    assert_eq!(a.hop_size(), HOP);
    let out = run(&mut a, 440.0).expect("pitched");
    assert!((out[0] - 440.0).abs() < 0.5, "freq {}", out[0]);
    assert_eq!(out[2], 69.0);
    assert!(out[3].abs() < 3.0, "cents {}", out[3]);
    assert_eq!(&out[6..9], &[5.0, 0.0, 4.0]); // A natural, octave 4
    assert_eq!(out[9], 6.0); // degree 6 in C major
    assert_eq!(out[10], 1.0);
    assert_eq!(out[11], 3.0); // A4 is the second space in treble
}

#[test]
fn spells_by_key() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    // D major (D=1): MIDI 66 -> F sharp.
    assert!(a.configure(1, 0, 0, 0, 440.0));
    assert_eq!(a.spell(66), vec![3, 1, 4]);
    // D flat major: MIDI 66 -> G flat.
    assert!(a.configure(1, -1, 0, 0, 440.0));
    assert_eq!(a.spell(66), vec![4, -1, 4]);
}

#[test]
fn rejects_unsupported_key_and_keeps_previous() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    assert!(a.configure(1, 0, 0, 0, 440.0));
    // G sharp major does not exist as a practical key.
    assert!(!a.configure(4, 1, 0, 0, 440.0));
    assert_eq!(a.spell(66), vec![3, 1, 4]);
}

#[test]
fn uses_clef_and_reference() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    assert!(a.configure(0, 0, 0, 2, 442.0)); // C major, bass clef, A4 = 442
    let out = run(&mut a, 442.0).expect("pitched");
    assert_eq!(out[2], 69.0);
    assert_eq!(out[11], 15.0); // A4 is far above the bass staff
}

#[test]
fn silence_and_short_output_buffer_return_false() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    let mut out = vec![0.0; FRAME_FIELDS];
    assert!(!a.process(&vec![0.0; FRAME], &mut out));
    let mut short = vec![0.0; 3];
    assert!(!a.process(&sine(440.0, FRAME, 0), &mut short));
}

#[test]
fn lists_keys_and_signatures() {
    let keys = all_keys();
    assert_eq!(keys.len(), 30 * 3);
    assert_eq!(key_signature(1, 0, 0), 2); // D major
    assert_eq!(key_signature(5, 0, 1), 0); // A minor
    assert_eq!(key_signature(4, 1, 0), 0); // unsupported -> 0
}

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
    assert_eq!(FRAME_FIELDS, 15);
}

#[test]
fn reports_vibrato_center() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    let mut out = vec![0.0; FRAME_FIELDS];
    let mut centers = Vec::new();
    let mut raw = Vec::new();
    // A4 with 5.5 Hz, ±40 cent vibrato, 20 cents sharp on average.
    let mut phase = 0.0f64;
    let signal: Vec<f32> = (0..(SR as usize * 2))
        .map(|i| {
            let t = i as f64 / SR as f64;
            let midi = 69.2 + 0.4 * (std::f64::consts::TAU * 5.5 * t).sin();
            phase += std::f64::consts::TAU * 440.0 * ((midi - 69.0) / 12.0).exp2() / SR as f64;
            (0.5 * phase.sin()) as f32
        })
        .collect();
    for (i, frame) in signal.windows(FRAME).step_by(HOP).enumerate() {
        if a.process(frame, &mut out) && i > 50 {
            assert_eq!(out[2], 69.0);
            centers.push(out[13]);
            raw.push(out[3]);
            let expected = (out[12] - out[2]) * 100.0;
            assert!((out[13] - expected).abs() < 0.01);
            assert_eq!(out[14], 1.0, "center ready");
        }
    }
    assert!(centers.len() > 100);
    assert!(
        centers.iter().all(|c| (c - 20.0).abs() < 6.0),
        "{centers:?}"
    );
    assert!(raw.iter().any(|&c| c > 45.0) && raw.iter().any(|&c| c < -5.0));
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
    assert!((out[12] - 69.0).abs() < 0.03, "center midi {}", out[12]);
    assert!(out[13].abs() < 3.0, "center cents {}", out[13]);
    assert_eq!(out[14], 1.0); // a steady tone: center ready
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

/// Counts `(pitched, drone_leak)` frames over a steady tone with harmonics.
fn count(a: &mut Analyzer, freq: f32, harmonics: &[f32]) -> (usize, usize) {
    let mut out = vec![0.0; FRAME_FIELDS];
    let (mut pitched, mut leaks) = (0, 0);
    for hop in 0..20 {
        let frame: Vec<f32> = (0..FRAME)
            .map(|i| {
                let ph = std::f32::consts::TAU * freq * (i + hop * HOP) as f32 / SR;
                harmonics
                    .iter()
                    .enumerate()
                    .map(|(k, h)| 0.2 * h * ((k + 1) as f32 * ph).sin())
                    .sum()
            })
            .collect();
        if a.process(&frame, &mut out) {
            pitched += 1;
        }
        if a.drone_leak() {
            leaks += 1;
        }
    }
    (pitched, leaks)
}

#[test]
fn drone_filter_ignores_the_drone_but_not_a_voice() {
    let drone = [1.0, 0.2];
    let voice = [1.0, 0.6, 0.4, 0.3, 0.2];
    let mut a = Analyzer::new(SR, FRAME, HOP);
    assert_eq!(count(&mut a, 220.0, &drone), (20, 0));

    a.set_drone(220.0, true);
    assert_eq!(count(&mut a, 220.0, &drone), (0, 20));
    // Right after the leak, a voice on the drone pitch must hold for 5
    // frames before it is shown (a stream glitch lasts 4).
    assert_eq!(count(&mut a, 220.0, &voice), (16, 0));

    a.set_drone(220.0, false);
    assert_eq!(count(&mut a, 220.0, &drone), (20, 20));

    for off in [0.0, -1.0, f32::NAN] {
        a.set_drone(off, true);
        assert_eq!(count(&mut a, 220.0, &drone), (20, 0));
    }
}

#[test]
fn reports_the_noise_floor_and_gate_on_unpitched_frames() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    assert_eq!(a.noise_floor(), 0.0);
    assert!((a.gate() - 0.005).abs() < 1e-6);
    // White-ish noise at about −50 dBFS RMS for one second.
    let mut seed = 7u32;
    let noise: Vec<f32> = (0..SR as usize)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            0.0110 * (seed as f32 / u32::MAX as f32 - 0.5)
        })
        .collect();
    let mut out = vec![0.0; FRAME_FIELDS];
    for frame in noise.windows(FRAME).step_by(HOP) {
        assert!(!a.process(frame, &mut out));
    }
    let floor_db = 20.0 * a.noise_floor().log10();
    let gate_db = 20.0 * a.gate().log10();
    assert!((floor_db + 50.0).abs() < 3.0, "floor {floor_db}");
    assert!((gate_db - floor_db - 11.0).abs() < 0.1, "gate {gate_db}");
    a.reset();
    assert_eq!(a.noise_floor(), 0.0);
}

#[test]
fn an_a4_change_keeps_the_noise_floor_and_respells_at_once() {
    let mut a = Analyzer::new(SR, FRAME, HOP);
    let mut seed = 11u32;
    let noise: Vec<f32> = (0..SR as usize)
        .map(|_| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            0.0110 * (seed as f32 / u32::MAX as f32 - 0.5)
        })
        .collect();
    let mut out = vec![0.0; FRAME_FIELDS];
    for frame in noise.windows(FRAME).step_by(HOP) {
        assert!(!a.process(frame, &mut out));
    }
    let floor = a.noise_floor();
    let gate = a.gate();
    assert!(floor > 0.0);

    // A4 = 442: the floor and gate are about the room, not the reference.
    assert!(a.configure(0, 0, 0, 0, 442.0));
    assert_eq!(a.noise_floor(), floor);
    assert_eq!(a.gate(), gate);

    // 440 Hz is now about 8 cents flat of A4.
    let out = run(&mut a, 440.0).expect("pitched");
    assert_eq!(out[2], 69.0);
    assert!((out[3] + 7.85).abs() < 1.0, "cents {}", out[3]);
    assert!(a.noise_floor() > 0.0);
}

//! Integration tests for clef staff positions, key-signature layout and
//! frequency <-> MIDI conversion.

use ktone_core::theory::{freq_to_midi, midi_to_freq, Clef, Key, Letter, Mode, SpelledNote};

fn n(letter: Letter, accidental: i8, octave: i32) -> SpelledNote {
    SpelledNote {
        letter,
        accidental,
        octave,
    }
}

#[test]
fn middle_c_in_every_clef() {
    let c4 = n(Letter::C, 0, 4);
    assert_eq!(Clef::Treble.staff_step(&c4), -2);
    assert_eq!(Clef::Bass.staff_step(&c4), 10);
    assert_eq!(Clef::Alto.staff_step(&c4), 4);
    assert_eq!(Clef::Tenor.staff_step(&c4), 6);
    assert_eq!(Clef::Treble8vb.staff_step(&c4), 5);
}

#[test]
fn bottom_and_top_lines() {
    let cases = [
        (Clef::Treble, n(Letter::E, 0, 4), n(Letter::F, 0, 5)),
        (Clef::Treble8vb, n(Letter::E, 0, 3), n(Letter::F, 0, 4)),
        (Clef::Bass, n(Letter::G, 0, 2), n(Letter::A, 0, 3)),
        (Clef::Alto, n(Letter::F, 0, 3), n(Letter::G, 0, 4)),
        (Clef::Tenor, n(Letter::D, 0, 3), n(Letter::E, 0, 4)),
    ];
    for (clef, bottom, top) in cases {
        assert_eq!(clef.staff_step(&bottom), 0, "{clef:?}");
        assert_eq!(clef.staff_step(&top), 8, "{clef:?}");
    }
}

#[test]
fn treble8vb_is_treble_one_octave_up() {
    for m in 24..=96 {
        let note = Key::new(Letter::C, 0, Mode::Major).unwrap().spell(m);
        let written = SpelledNote {
            octave: note.octave + 1,
            ..note
        };
        assert_eq!(
            Clef::Treble8vb.staff_step(&note),
            Clef::Treble.staff_step(&written)
        );
    }
}

#[test]
fn staff_step_ignores_accidental_but_not_letter_octave() {
    // B#3 sounds like C4 but sits a step lower; Cb4 sounds like B3 but sits a step higher.
    assert_eq!(Clef::Treble.staff_step(&n(Letter::B, 1, 3)), -3);
    assert_eq!(Clef::Treble.staff_step(&n(Letter::C, -1, 4)), -2);
    for clef in Clef::ALL {
        for acc in -2..=2 {
            assert_eq!(
                clef.staff_step(&n(Letter::G, acc, 4)),
                clef.staff_step(&n(Letter::G, 0, 4))
            );
        }
        // One octave is seven steps.
        assert_eq!(
            clef.staff_step(&n(Letter::D, 0, 5)) - clef.staff_step(&n(Letter::D, 0, 4)),
            7
        );
    }
    assert_eq!(Clef::Treble.staff_step(&n(Letter::A, 0, 5)), 10);
    assert_eq!(Clef::Bass.staff_step(&n(Letter::E, 0, 2)), -2);
}

#[test]
fn signature_steps_treble_and_bass() {
    let sharps = |c: Clef| {
        c.signature_steps(7)
            .iter()
            .map(|&(_, s)| s)
            .collect::<Vec<_>>()
    };
    let flats = |c: Clef| {
        c.signature_steps(-7)
            .iter()
            .map(|&(_, s)| s)
            .collect::<Vec<_>>()
    };
    // Treble: F5 C5 G5 D5 A4 E5 B4 / B4 E5 A4 D5 G4 C5 F4.
    assert_eq!(sharps(Clef::Treble), [8, 5, 9, 6, 3, 7, 4]);
    assert_eq!(flats(Clef::Treble), [4, 7, 3, 6, 2, 5, 1]);
    assert_eq!(sharps(Clef::Treble8vb), sharps(Clef::Treble));
    assert_eq!(flats(Clef::Treble8vb), flats(Clef::Treble));
    // Bass: F3 C3 G3 D3 A2 E3 B2 / B2 E3 A2 D3 G2 C3 F2.
    assert_eq!(sharps(Clef::Bass), [6, 3, 7, 4, 1, 5, 2]);
    assert_eq!(flats(Clef::Bass), [2, 5, 1, 4, 0, 3, -1]);
    // Alto: F4 C4 G4 D4 A3 E4 B3 / B3 E4 A3 D4 G3 C4 F3.
    assert_eq!(sharps(Clef::Alto), [7, 4, 8, 5, 2, 6, 3]);
    assert_eq!(flats(Clef::Alto), [3, 6, 2, 5, 1, 4, 0]);
    // Tenor: F3 C4 G3 D4 A3 E4 B3 / B3 E4 A3 D4 G3 C4 F3.
    assert_eq!(sharps(Clef::Tenor), [2, 6, 3, 7, 4, 8, 5]);
    assert_eq!(flats(Clef::Tenor), [5, 8, 4, 7, 3, 6, 2]);
}

#[test]
fn signature_steps_lengths_and_signs() {
    for clef in Clef::ALL {
        assert!(clef.signature_steps(0).is_empty());
        for sig in -7i8..=7 {
            let steps = clef.signature_steps(sig);
            assert_eq!(steps.len(), sig.unsigned_abs() as usize);
            assert!(steps.iter().all(|&(a, _)| a == sig.signum()));
        }
        assert_eq!(clef.signature_steps(100).len(), 7);
        assert_eq!(clef.signature_steps(i8::MIN).len(), 7);
    }
    assert_eq!(Clef::Treble.signature_steps(2), vec![(1, 8), (1, 5)]);
    assert_eq!(Clef::Bass.signature_steps(-1), vec![(-1, 2)]);
}

#[test]
fn signature_steps_match_key_letters() {
    // Each drawn accidental sits on a line/space of a letter the key alters.
    for clef in Clef::ALL {
        for k in Key::all() {
            for (acc, step) in clef.signature_steps(k.signature()) {
                let altered = k.scale().iter().any(|&(l, a)| {
                    a == acc && {
                        // Same letter: staff step difference is a multiple of 7.
                        let s = clef.staff_step(&n(l, 0, 4));
                        (s - step).rem_euclid(7) == 0
                    }
                });
                assert!(altered, "{clef:?} {k:?} step {step}");
            }
        }
    }
}

fn close(a: f32, b: f32, eps: f32) -> bool {
    (a - b).abs() <= eps
}

#[test]
fn freq_midi_at_440() {
    assert!(close(freq_to_midi(440.0, 440.0), 69.0, 1e-5));
    assert!(close(freq_to_midi(261.625_57, 440.0), 60.0, 1e-4));
    assert!(close(freq_to_midi(880.0, 440.0), 81.0, 1e-5));
    assert!(close(freq_to_midi(82.406_89, 440.0), 40.0, 1e-4)); // E2
    assert!(close(midi_to_freq(69.0, 440.0), 440.0, 1e-3));
    assert!(close(midi_to_freq(60.0, 440.0), 261.625_57, 1e-3));
    assert!(close(midi_to_freq(84.0, 440.0), 1046.502, 1e-2)); // C6
                                                               // A quarter tone above A4 is 69.5.
    assert!(close(
        freq_to_midi(440.0 * 2f32.powf(0.5 / 12.0), 440.0),
        69.5,
        1e-4
    ));
}

#[test]
fn freq_midi_with_other_references() {
    for a4 in [442.0f32, 432.0, 415.0] {
        assert!(close(freq_to_midi(a4, a4), 69.0, 1e-5));
        assert!(close(midi_to_freq(69.0, a4), a4, 1e-3));
        assert!(close(midi_to_freq(57.0, a4), a4 / 2.0, 1e-3));
    }
    // 440 Hz against A4 = 442 is about 7.85 cents flat.
    assert!(close(freq_to_midi(440.0, 442.0), 69.0 - 0.078_514, 1e-4));
    // 440 Hz against A4 = 432 is about 31.77 cents sharp.
    assert!(close(freq_to_midi(440.0, 432.0), 69.0 + 0.317_667, 1e-4));
    assert!(close(midi_to_freq(60.0, 432.0), 256.869, 1e-2));
    assert!(close(midi_to_freq(60.0, 442.0), 262.815, 1e-2));
}

#[test]
fn freq_midi_round_trip() {
    for a4 in [432.0f32, 440.0, 442.0] {
        let mut m = 20.0f32;
        while m < 110.0 {
            let back = freq_to_midi(midi_to_freq(m, a4), a4);
            assert!(close(back, m, 1e-3), "{m} {a4} -> {back}");
            m += 0.37;
        }
    }
}

#[test]
fn freq_midi_guards_against_bad_input() {
    assert!(freq_to_midi(0.0, 440.0).is_nan());
    assert!(freq_to_midi(-100.0, 440.0).is_nan());
    assert!(freq_to_midi(440.0, 0.0).is_nan());
    assert!(freq_to_midi(440.0, -440.0).is_nan());
    assert!(freq_to_midi(f32::NAN, 440.0).is_nan());
    assert!(freq_to_midi(f32::INFINITY, 440.0).is_nan());
    assert!(midi_to_freq(69.0, 0.0).is_nan());
    assert!(midi_to_freq(69.0, -1.0).is_nan());
    assert!(midi_to_freq(f32::NAN, 440.0).is_nan());
    assert!(midi_to_freq(69.0, f32::NAN).is_nan());
}

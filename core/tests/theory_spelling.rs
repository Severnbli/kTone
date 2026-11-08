//! Integration tests for key-aware note spelling, keys and scale degrees.

use ktone_core::theory::{Key, Letter, Mode, SpelledNote};

/// Parse a note name like "C", "F#", "Bb", "Fx" (double sharp), "Ebb".
fn parse(name: &str) -> (Letter, i8) {
    let mut chars = name.chars();
    let letter = match chars.next().unwrap() {
        'C' => Letter::C,
        'D' => Letter::D,
        'E' => Letter::E,
        'F' => Letter::F,
        'G' => Letter::G,
        'A' => Letter::A,
        'B' => Letter::B,
        c => panic!("bad letter {c}"),
    };
    let acc = chars
        .map(|c| match c {
            '#' => 1,
            'x' => 2,
            'b' => -1,
            c => panic!("bad accidental {c}"),
        })
        .sum();
    (letter, acc)
}

fn key(name: &str, mode: Mode) -> Key {
    let (l, a) = parse(name);
    Key::new(l, a, mode).unwrap_or_else(|| panic!("{name} {mode:?} should exist"))
}

fn note(name: &str, octave: i32) -> SpelledNote {
    let (letter, accidental) = parse(name);
    SpelledNote {
        letter,
        accidental,
        octave,
    }
}

/// (tonic, signature, natural scale from degree 1 to 7).
const MAJOR: [(&str, i8, &str); 15] = [
    ("Cb", -7, "Cb Db Eb Fb Gb Ab Bb"),
    ("Gb", -6, "Gb Ab Bb Cb Db Eb F"),
    ("Db", -5, "Db Eb F Gb Ab Bb C"),
    ("Ab", -4, "Ab Bb C Db Eb F G"),
    ("Eb", -3, "Eb F G Ab Bb C D"),
    ("Bb", -2, "Bb C D Eb F G A"),
    ("F", -1, "F G A Bb C D E"),
    ("C", 0, "C D E F G A B"),
    ("G", 1, "G A B C D E F#"),
    ("D", 2, "D E F# G A B C#"),
    ("A", 3, "A B C# D E F# G#"),
    ("E", 4, "E F# G# A B C# D#"),
    ("B", 5, "B C# D# E F# G# A#"),
    ("F#", 6, "F# G# A# B C# D# E#"),
    ("C#", 7, "C# D# E# F# G# A# B#"),
];

/// (tonic, signature, natural minor scale, raised 6th, raised 7th).
const MINOR: [(&str, i8, &str, &str, &str); 15] = [
    ("Ab", -7, "Ab Bb Cb Db Eb Fb Gb", "F", "G"),
    ("Eb", -6, "Eb F Gb Ab Bb Cb Db", "C", "D"),
    ("Bb", -5, "Bb C Db Eb F Gb Ab", "G", "A"),
    ("F", -4, "F G Ab Bb C Db Eb", "D", "E"),
    ("C", -3, "C D Eb F G Ab Bb", "A", "B"),
    ("G", -2, "G A Bb C D Eb F", "E", "F#"),
    ("D", -1, "D E F G A Bb C", "B", "C#"),
    ("A", 0, "A B C D E F G", "F#", "G#"),
    ("E", 1, "E F# G A B C D", "C#", "D#"),
    ("B", 2, "B C# D E F# G A", "G#", "A#"),
    ("F#", 3, "F# G# A B C# D E", "D#", "E#"),
    ("C#", 4, "C# D# E F# G# A B", "A#", "B#"),
    ("G#", 5, "G# A# B C# D# E F#", "E#", "Fx"),
    ("D#", 6, "D# E# F# G# A# B C#", "B#", "Cx"),
    ("A#", 7, "A# B# C# D# E# F# G#", "Fx", "Gx"),
];

fn scale_of(s: &str) -> Vec<(Letter, i8)> {
    s.split_whitespace().map(parse).collect()
}

#[test]
fn all_has_30_unique_keys_in_documented_order() {
    let all = Key::all();
    assert_eq!(all.len(), 30);
    for (i, a) in all.iter().enumerate() {
        for b in &all[i + 1..] {
            assert_ne!(a, b);
        }
    }
    let expected: Vec<Key> = MAJOR
        .iter()
        .map(|&(t, ..)| key(t, Mode::Major))
        .chain(MINOR.iter().map(|&(t, ..)| key(t, Mode::Minor)))
        .collect();
    assert_eq!(all, expected);
    for (i, k) in all.iter().enumerate() {
        assert_eq!(k.signature(), (i % 15) as i8 - 7);
    }
}

#[test]
fn signatures() {
    for &(t, sig, ..) in &MAJOR {
        assert_eq!(key(t, Mode::Major).signature(), sig, "{t} major");
    }
    for &(t, sig, ..) in &MINOR {
        assert_eq!(key(t, Mode::Minor).signature(), sig, "{t} minor");
    }
}

#[test]
fn theoretical_and_invalid_keys_are_rejected() {
    let none = [
        ("G#", Mode::Major),
        ("D#", Mode::Major),
        ("A#", Mode::Major),
        ("E#", Mode::Major),
        ("B#", Mode::Major),
        ("Fb", Mode::Major),
        ("Db", Mode::Minor),
        ("Gb", Mode::Minor),
        ("Cb", Mode::Minor),
        ("Fb", Mode::Minor),
        ("E#", Mode::Minor),
        ("B#", Mode::Minor),
    ];
    for (t, mode) in none {
        let (l, a) = parse(t);
        assert_eq!(Key::new(l, a, mode), None, "{t} {mode:?}");
    }
    for acc in [-128, -3, -2, 2, 3, 127] {
        assert_eq!(Key::new(Letter::C, acc, Mode::Major), None);
        assert_eq!(Key::new(Letter::A, acc, Mode::Minor), None);
    }
}

#[test]
fn relative_keys() {
    assert_eq!(key("C", Mode::Major).relative(), key("A", Mode::Minor));
    assert_eq!(key("Eb", Mode::Minor).relative(), key("Gb", Mode::Major));
    for k in Key::all() {
        assert_eq!(k.relative().signature(), k.signature());
        assert_eq!(k.relative().relative(), k);
    }
}

#[test]
fn diatonic_notes_use_key_spelling() {
    let check = |k: Key, scale: &str| {
        let expected = scale_of(scale);
        assert_eq!(k.scale().to_vec(), expected, "{k:?}");
        // Spell each degree in octave 4 by its MIDI number.
        for (deg, &(l, a)) in expected.iter().enumerate() {
            for octave in [2, 4, 5] {
                let n = SpelledNote {
                    letter: l,
                    accidental: a,
                    octave,
                };
                assert_eq!(k.spell(n.midi()), n, "{k:?} degree {}", deg + 1);
                assert_eq!(k.scale_degree(&n), Some(deg as u8 + 1));
            }
        }
    };
    for &(t, _, s) in &MAJOR {
        check(key(t, Mode::Major), s);
    }
    for &(t, _, s, _, _) in &MINOR {
        check(key(t, Mode::Minor), s);
    }
}

#[test]
fn spot_checks_from_spec() {
    let d = key("D", Mode::Major);
    assert_eq!(d.spell(66), note("F#", 4));
    assert_eq!(d.spell(73), note("C#", 5));
    let db = key("Db", Mode::Major);
    assert_eq!(db.spell(66), note("Gb", 4));
    let cb = key("Cb", Mode::Major);
    assert_eq!(cb.spell(64), note("Fb", 4));
    let cs = key("C#", Mode::Major);
    assert_eq!(cs.spell(65), note("E#", 4));
    assert_eq!(cs.spell(60), note("B#", 3));
}

#[test]
fn octave_boundaries() {
    // B#3 and Cb4 are named after the octave of their letter.
    let cs = key("C#", Mode::Major);
    assert_eq!(cs.spell(60), note("B#", 3));
    assert_eq!(cs.spell(48), note("B#", 2));
    assert_eq!(note("B#", 3).midi(), 60);
    let cb = key("Cb", Mode::Major);
    assert_eq!(cb.spell(59), note("Cb", 4));
    assert_eq!(cb.spell(71), note("Cb", 5));
    assert_eq!(note("Cb", 4).midi(), 59);
    // Double sharp from the A# minor leading tone keeps its letter octave.
    let ais = key("A#", Mode::Minor);
    assert_eq!(ais.spell(69), note("Gx", 4));
    // Edges of the MIDI range.
    let c = key("C", Mode::Major);
    assert_eq!(c.spell(0), note("C", -1));
    assert_eq!(c.spell(127), note("G", 9));
    assert_eq!(cb.spell(11), note("Cb", 0));
    assert_eq!(cs.spell(0), note("B#", -2));
}

#[test]
fn midi_of_spelled_notes() {
    assert_eq!(note("C", 4).midi(), 60);
    assert_eq!(note("A", 4).midi(), 69);
    assert_eq!(note("C", -1).midi(), 0);
    assert_eq!(note("G", 9).midi(), 127);
    assert_eq!(note("Fx", 4).midi(), 67);
    assert_eq!(note("Ebb", 4).midi(), 62);
}

#[test]
fn every_pitch_round_trips_in_every_key() {
    for k in Key::all() {
        for m in 0..=127 {
            let n = k.spell(m);
            assert_eq!(n.midi(), m, "{k:?} {m} -> {n:?}");
        }
    }
}

#[test]
fn spelling_is_octave_invariant() {
    for k in Key::all() {
        for m in 0..=115 {
            let a = k.spell(m);
            let b = k.spell(m + 12);
            assert_eq!(
                (a.letter, a.accidental, a.octave + 1),
                (b.letter, b.accidental, b.octave)
            );
        }
    }
}

#[test]
fn twelve_distinct_spellings_per_key() {
    for k in Key::all() {
        let names: Vec<(Letter, i8)> = (60..72)
            .map(|m| (k.spell(m).letter, k.spell(m).accidental))
            .collect();
        for (i, a) in names.iter().enumerate() {
            assert!(!names[i + 1..].contains(a), "{k:?} duplicate {a:?}");
        }
    }
}

#[test]
fn chromatic_notes_never_use_double_accidentals() {
    for k in Key::all() {
        let scale = k.scale();
        for m in 60..72 {
            let n = k.spell(m);
            let degree = k.scale_degree(&n);
            let diatonic = scale.contains(&(n.letter, n.accidental));
            if !diatonic && degree.is_none() {
                assert!(n.accidental.abs() <= 1, "{k:?} {m} -> {n:?}");
            }
            if n.accidental.abs() == 2 {
                // Only the minor raised 6th/7th may need it, and only in keys that already sharp them.
                assert_eq!(k.mode, Mode::Minor);
                assert!(k.signature() >= 5, "{k:?}");
            }
        }
    }
}

#[test]
fn minor_raised_sixth_and_seventh() {
    for &(t, _, scale, six, seven) in &MINOR {
        let k = key(t, Mode::Minor);
        let s = scale_of(scale);
        for (deg, name) in [(6u8, six), (7u8, seven)] {
            let (l, a) = parse(name);
            let expected_letter = s[deg as usize - 1].0;
            assert_eq!(l, expected_letter);
            assert_eq!(a, s[deg as usize - 1].1 + 1);
            let n = SpelledNote {
                letter: l,
                accidental: a,
                octave: 4,
            };
            assert_eq!(k.spell(n.midi()), n, "{t} minor raised {deg}");
            assert_eq!(k.scale_degree(&n), Some(deg));
        }
    }
    assert_eq!(key("A", Mode::Minor).spell(68), note("G#", 4));
    assert_eq!(key("F", Mode::Minor).spell(64), note("E", 4));
    assert_eq!(key("G#", Mode::Minor).spell(67), note("Fx", 4));
}

/// Spellings of the 12 pitch classes (C upward) in octave-agnostic form.
fn chromatic(k: Key) -> Vec<(Letter, i8)> {
    (60..72)
        .map(|m| {
            let n = k.spell(m);
            (n.letter, n.accidental)
        })
        .collect()
}

#[test]
fn chromatic_rule_tables() {
    let cases: [(&str, Mode, &str); 10] = [
        ("C", Mode::Major, "C C# D Eb E F F# G G# A Bb B"),
        ("A", Mode::Minor, "C C# D Eb E F F# G G# A Bb B"),
        // Sharp key: ties raise the lower neighbor, otherwise the smaller accidental wins.
        ("D", Mode::Major, "C C# D D# E F F# G G# A A# B"),
        ("E", Mode::Minor, "C C# D D# E F F# G G# A A# B"),
        ("C#", Mode::Major, "B# C# D D# E E# F# G G# A A# B"),
        // Flat key: ties lower the upper neighbor.
        ("F", Mode::Major, "C Db D Eb E F Gb G Ab A Bb B"),
        ("Db", Mode::Major, "C Db D Eb E F Gb G Ab A Bb B"),
        ("Cb", Mode::Major, "C Db D Eb Fb F Gb G Ab A Bb Cb"),
        ("F", Mode::Minor, "C Db D Eb E F Gb G Ab A Bb B"),
        ("G#", Mode::Minor, "C C# D D# E E# F# Fx G# A A# B"),
    ];
    for (t, mode, expected) in cases {
        assert_eq!(chromatic(key(t, mode)), scale_of(expected), "{t} {mode:?}");
    }
}

#[test]
fn chromatic_notes_have_no_scale_degree() {
    let c = key("C", Mode::Major);
    for name in ["C#", "Eb", "F#", "G#", "Bb", "Db", "B#", "Fb"] {
        assert_eq!(c.scale_degree(&note(name, 4)), None, "{name}");
    }
    let a = key("A", Mode::Minor);
    assert_eq!(a.scale_degree(&note("G#", 4)), Some(7));
    assert_eq!(a.scale_degree(&note("F#", 4)), Some(6));
    assert_eq!(a.scale_degree(&note("C#", 4)), None);
    assert_eq!(a.scale_degree(&note("Bb", 4)), None);
    assert_eq!(a.scale_degree(&note("Gx", 4)), None);
    // Enharmonic but not the key's spelling.
    let d = key("D", Mode::Major);
    assert_eq!(d.scale_degree(&note("Gb", 4)), None);
    assert_eq!(d.scale_degree(&note("F#", 4)), Some(3));
    assert_eq!(d.scale_degree(&note("D", 7)), Some(1));
    // Raised degrees only count in minor.
    assert_eq!(key("C", Mode::Major).scale_degree(&note("A#", 4)), None);
    assert_eq!(key("C", Mode::Major).scale_degree(&note("B#", 4)), None);
}

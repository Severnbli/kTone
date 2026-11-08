//! Music theory: frequency <-> MIDI, key-aware note spelling, scale degrees, clefs.
//!
//! CONTRACT – the public API below is consumed by the WASM bindings.
//! Do not change signatures without updating `wasm/` and AGENTS.md.
//! Octaves use scientific pitch notation (C4 = middle C, MIDI 60, A4 = MIDI 69).
//!
//! # Spelling rules
//!
//! [`Key::spell`] maps each of the 12 pitch classes to exactly one spelling
//! (letter + accidental) for a given key, then attaches the octave of the
//! *letter*. The table is built deterministically:
//!
//! 1. **Diatonic pitches** use the key's own spelling (natural minor for minor keys).
//! 2. **Minor keys only:** the raised 6th and raised 7th (melodic / harmonic minor)
//!    are spelled as raised degrees: G♯ and F♯ in A minor, E♮ and D♮ in F minor,
//!    F𝄪 and E♯ in G♯ minor. These are the only chromatic spellings that may
//!    carry a double accidental, and only when the key itself needs it.
//! 3. **Other chromatic pitches** always sit in a whole-step gap between two
//!    diatonic notes. The two candidates are the raised lower neighbor and the
//!    lowered upper neighbor:
//!    - the candidate with the smaller absolute accidental wins (so D major uses
//!      F♮ rather than E♯, C♯ major uses D♮ rather than C𝄪, C♭ major uses C♮
//!      rather than D𝄫); this guarantees no double accidentals;
//!    - on a tie, sharp keys (signature > 0) raise the lower neighbor (D♯ in
//!      D major) and flat keys (signature < 0) lower the upper neighbor (G♭ in
//!      F major);
//!    - keys without a signature (C major, A minor) use the common-practice set
//!      C♯, E♭, F♯, G♯, B♭ (♯1, ♭3, ♯4, ♯5, ♭7 of C major).

/// Natural note letter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Letter {
    C,
    D,
    E,
    F,
    G,
    A,
    B,
}

/// Pitch class of each natural letter, indexed by [`Letter::index`].
const NATURAL_PC: [i32; 7] = [0, 2, 4, 5, 7, 9, 11];

/// Position of each natural letter on the line of fifths (C = 0, G = 1, F = -1),
/// indexed by [`Letter::index`].
const FIFTHS: [i32; 7] = [0, 2, 4, -1, 1, 3, 5];

impl Letter {
    /// All letters in ascending order, C to B.
    pub const ALL: [Letter; 7] = [
        Letter::C,
        Letter::D,
        Letter::E,
        Letter::F,
        Letter::G,
        Letter::A,
        Letter::B,
    ];

    /// 0 for C, 1 for D, ..., 6 for B.
    pub fn index(self) -> usize {
        self as usize
    }

    /// Letter for an index; wraps around, so 7 is C again and -1 is B.
    pub fn from_index(index: i32) -> Letter {
        Letter::ALL[index.rem_euclid(7) as usize]
    }

    /// Pitch class (0..=11, C = 0) of the natural letter.
    pub fn pitch_class(self) -> i32 {
        NATURAL_PC[self.index()]
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Mode {
    Major,
    /// Natural minor for the signature; the leading tone (raised 7th) is spelled as in harmonic minor.
    Minor,
}

/// A note spelled for display: letter + accidental + octave.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SpelledNote {
    pub letter: Letter,
    /// -2 = double flat, -1 = flat, 0 = natural, 1 = sharp, 2 = double sharp.
    pub accidental: i8,
    /// Scientific octave number of the *letter* (B#3 is MIDI 60, Cb4 is MIDI 59).
    pub octave: i32,
}

impl SpelledNote {
    /// MIDI number this spelling sounds as.
    pub fn midi(&self) -> i32 {
        (self.octave + 1) * 12 + self.letter.pitch_class() + i32::from(self.accidental)
    }

    /// Diatonic step number ignoring the accidental: `octave * 7 + letter index`
    /// (C4 = 28, E4 = 30). Used for staff positions.
    pub fn diatonic_step(&self) -> i32 {
        self.octave * 7 + self.letter.index() as i32
    }
}

/// A key: tonic spelling + mode. Supports all 15 major and 15 minor keys
/// with up to 7 sharps or flats.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Key {
    pub tonic: Letter,
    pub tonic_accidental: i8,
    pub mode: Mode,
}

/// Signature of a key given its tonic and mode, without range checking.
fn raw_signature(tonic: Letter, tonic_accidental: i8, mode: Mode) -> i32 {
    let major = FIFTHS[tonic.index()] + 7 * i32::from(tonic_accidental);
    match mode {
        Mode::Major => major,
        Mode::Minor => major - 3,
    }
}

/// Accidental that a key signature applies to `letter`.
fn signature_accidental(signature: i32, letter: Letter) -> i8 {
    let f = FIFTHS[letter.index()];
    // Sharps are added in fifths order F C G D A E B (f = -1..=5),
    // flats in the reverse order B E A D G C F.
    let sharps = (signature - 2 - f).div_euclid(7) + 1;
    let flats = (-signature - 1 - (5 - f)).div_euclid(7) + 1;
    (sharps.max(0) - flats.max(0)) as i8
}

/// Fixed chromatic spellings for keys without a signature (C major, A minor),
/// indexed by pitch class. Diatonic entries are unused.
const NO_SIGNATURE_CHROMATIC: [(Letter, i8); 12] = [
    (Letter::C, 0),
    (Letter::C, 1),
    (Letter::D, 0),
    (Letter::E, -1),
    (Letter::E, 0),
    (Letter::F, 0),
    (Letter::F, 1),
    (Letter::G, 0),
    (Letter::G, 1),
    (Letter::A, 0),
    (Letter::B, -1),
    (Letter::B, 0),
];

fn spelling_pc(letter: Letter, accidental: i8) -> usize {
    (letter.pitch_class() + i32::from(accidental)).rem_euclid(12) as usize
}

impl Key {
    /// `None` if the key would need more than 7 sharps/flats (e.g. G# major,
    /// Db minor), which also rejects every double-accidental tonic.
    pub fn new(tonic: Letter, tonic_accidental: i8, mode: Mode) -> Option<Key> {
        if !(-1..=1).contains(&tonic_accidental) {
            return None;
        }
        let sig = raw_signature(tonic, tonic_accidental, mode);
        if (-7..=7).contains(&sig) {
            Some(Key {
                tonic,
                tonic_accidental,
                mode,
            })
        } else {
            None
        }
    }

    /// Key with the given mode and signature (-7..=7), or `None` if out of range.
    pub fn from_signature(signature: i8, mode: Mode) -> Option<Key> {
        if !(-7..=7).contains(&signature) {
            return None;
        }
        let offset = match mode {
            Mode::Major => 0,
            Mode::Minor => 3,
        };
        // Position on the line of fifths; tonic letter + accidental from it.
        let pos = i32::from(signature) + offset;
        let natural = (pos + 1).rem_euclid(7) - 1; // -1..=5
        let accidental = ((pos - natural) / 7) as i8;
        let letter_index = FIFTHS
            .iter()
            .position(|&f| f == natural)
            .expect("every value in -1..=5 is a natural letter");
        Some(Key {
            tonic: Letter::ALL[letter_index],
            tonic_accidental: accidental,
            mode,
        })
    }

    /// All 30 supported keys, ordered by mode then by signature (-7..=7):
    /// C♭ major, G♭ major, ..., C♯ major, then A♭ minor, E♭ minor, ..., A♯ minor.
    pub fn all() -> Vec<Key> {
        [Mode::Major, Mode::Minor]
            .iter()
            .flat_map(|&mode| (-7..=7).filter_map(move |sig| Key::from_signature(sig, mode)))
            .collect()
    }

    /// Number of sharps (positive) or flats (negative) in the key signature.
    pub fn signature(&self) -> i8 {
        raw_signature(self.tonic, self.tonic_accidental, self.mode) as i8
    }

    /// The relative key (same signature, other mode): A minor for C major and back.
    pub fn relative(&self) -> Key {
        let mode = match self.mode {
            Mode::Major => Mode::Minor,
            Mode::Minor => Mode::Major,
        };
        Key::from_signature(self.signature(), mode).expect("signature is always in range")
    }

    /// The seven diatonic spellings (letter, accidental) from degree 1 to 7.
    /// For minor keys this is the natural minor scale.
    pub fn scale(&self) -> [(Letter, i8); 7] {
        let sig = i32::from(self.signature());
        let mut out = [(Letter::C, 0); 7];
        for (i, slot) in out.iter_mut().enumerate() {
            let letter = Letter::from_index(self.tonic.index() as i32 + i as i32);
            *slot = (letter, signature_accidental(sig, letter));
        }
        out
    }

    /// Spelling (letter, accidental) for each pitch class 0..=11, per the
    /// rules in the module documentation.
    pub fn spelling_table(&self) -> [(Letter, i8); 12] {
        let scale = self.scale();
        let mut table: [Option<(Letter, i8)>; 12] = [None; 12];
        for &(l, a) in &scale {
            table[spelling_pc(l, a)] = Some((l, a));
        }
        if self.mode == Mode::Minor {
            for &(l, a) in &scale[5..7] {
                table[spelling_pc(l, a + 1)] = Some((l, a + 1));
            }
        }
        let sig = self.signature();
        let mut out = [(Letter::C, 0); 12];
        for pc in 0..12 {
            out[pc] = match table[pc] {
                Some(s) => s,
                None if sig == 0 => NO_SIGNATURE_CHROMATIC[pc],
                None => {
                    let find = |p: usize| {
                        *scale
                            .iter()
                            .find(|&&(l, a)| spelling_pc(l, a) == p)
                            .expect("chromatic pitch lies between two diatonic notes")
                    };
                    let (ll, la) = find((pc + 11) % 12);
                    let (ul, ua) = find((pc + 1) % 12);
                    let raised = (ll, la + 1);
                    let lowered = (ul, ua - 1);
                    match raised.1.abs().cmp(&lowered.1.abs()) {
                        std::cmp::Ordering::Less => raised,
                        std::cmp::Ordering::Greater => lowered,
                        std::cmp::Ordering::Equal if sig > 0 => raised,
                        std::cmp::Ordering::Equal => lowered,
                    }
                }
            };
        }
        out
    }

    /// Spell a MIDI note in this key. Diatonic notes use the key's spelling.
    /// Chromatic notes follow a documented, deterministic rule (raised degrees in
    /// sharp keys, lowered in flat keys, sensible choices in C major / A minor,
    /// raised 7th in minor). Never returns double accidentals for chromatic notes
    /// unless the key itself requires it. See the module docs for the full rule.
    pub fn spell(&self, midi: i32) -> SpelledNote {
        let (letter, accidental) = self.spelling_table()[midi.rem_euclid(12) as usize];
        let octave = (midi - letter.pitch_class() - i32::from(accidental)).div_euclid(12) - 1;
        SpelledNote {
            letter,
            accidental,
            octave,
        }
    }

    /// 1..=7 if `note` is diatonic in this key (exact spelling match), otherwise `None`.
    /// In minor the raised 6th and raised 7th also count as degrees 6 and 7.
    pub fn scale_degree(&self, note: &SpelledNote) -> Option<u8> {
        let scale = self.scale();
        let degree = (note.letter.index() + 7 - self.tonic.index()) % 7;
        let expected = scale[degree].1;
        let raised_ok = self.mode == Mode::Minor && degree >= 5 && note.accidental == expected + 1;
        if note.accidental == expected || raised_ok {
            Some(degree as u8 + 1)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Clef {
    Treble,
    /// Treble clef sounding an octave lower (tenor voice).
    Treble8vb,
    Bass,
    Alto,
    Tenor,
}

/// Staff steps of the sharps (F C G D A E B) and flats (B E A D G C F) in treble clef.
const TREBLE_SHARPS: [i32; 7] = [8, 5, 9, 6, 3, 7, 4];
const TREBLE_FLATS: [i32; 7] = [4, 7, 3, 6, 2, 5, 1];
/// Tenor clef sharps use their own zigzag to stay inside the staff.
const TENOR_SHARPS: [i32; 7] = [2, 6, 3, 7, 4, 8, 5];

impl Clef {
    /// All clefs in UI order.
    pub const ALL: [Clef; 5] = [
        Clef::Treble,
        Clef::Treble8vb,
        Clef::Bass,
        Clef::Alto,
        Clef::Tenor,
    ];

    /// Diatonic step ([`SpelledNote::diatonic_step`]) of the bottom line, as sounding pitch.
    fn bottom_line(&self) -> i32 {
        match self {
            Clef::Treble => 4 * 7 + 2,    // E4
            Clef::Treble8vb => 3 * 7 + 2, // E3 (written E4)
            Clef::Bass => 2 * 7 + 4,      // G2
            Clef::Alto => 3 * 7 + 3,      // F3
            Clef::Tenor => 3 * 7 + 1,     // D3
        }
    }

    /// Vertical position on the 5-line staff in diatonic steps:
    /// 0 = bottom line, 1 = first space, ..., 8 = top line.
    /// Negative / >8 values need ledger lines.
    ///
    /// `note` is the sounding pitch. Bottom lines: treble E4, bass G2, alto F3,
    /// tenor D3, treble 8vb E3 (written as treble one octave higher). Depends on
    /// letter and octave only, not on the accidental. Middle C is -2 in treble,
    /// 10 in bass, 4 in alto, 6 in tenor.
    pub fn staff_step(&self, note: &SpelledNote) -> i32 {
        note.diatonic_step() - self.bottom_line()
    }

    /// Accidentals of a key signature with their staff steps, in drawing order
    /// (left to right), using standard engraving positions. Each entry is
    /// `(accidental, staff_step)` with accidental `1` (sharp) or `-1` (flat).
    /// `signature` is clamped to -7..=7. Treble 8vb uses the treble positions.
    pub fn signature_steps(&self, signature: i8) -> Vec<(i8, i32)> {
        let count = signature.unsigned_abs().min(7) as usize;
        let (acc, base): (i8, [i32; 7]) = if signature > 0 {
            let steps = match self {
                Clef::Tenor => TENOR_SHARPS,
                _ => TREBLE_SHARPS.map(|s| s + self.signature_shift()),
            };
            (1, steps)
        } else {
            (-1, TREBLE_FLATS.map(|s| s + self.signature_shift()))
        };
        base[..count].iter().map(|&s| (acc, s)).collect()
    }

    /// Offset of the signature pattern relative to treble clef.
    fn signature_shift(&self) -> i32 {
        match self {
            Clef::Treble | Clef::Treble8vb => 0,
            Clef::Bass => -2,
            Clef::Alto => -1,
            Clef::Tenor => 1,
        }
    }
}

/// Fractional MIDI number of `frequency_hz` given the A4 reference.
///
/// Returns `f32::NAN` if either argument is non-positive or not finite; never panics.
pub fn freq_to_midi(frequency_hz: f32, a4_hz: f32) -> f32 {
    if !(frequency_hz > 0.0 && a4_hz > 0.0 && frequency_hz.is_finite() && a4_hz.is_finite()) {
        return f32::NAN;
    }
    69.0 + 12.0 * (frequency_hz / a4_hz).log2()
}

/// Frequency in Hz of a (fractional) MIDI number given the A4 reference.
///
/// Returns `f32::NAN` if `a4_hz` is non-positive or either argument is not finite;
/// never panics.
pub fn midi_to_freq(midi: f32, a4_hz: f32) -> f32 {
    if !(a4_hz > 0.0 && a4_hz.is_finite() && midi.is_finite()) {
        return f32::NAN;
    }
    a4_hz * ((midi - 69.0) / 12.0).exp2()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_accidental_matches_known_keys() {
        assert_eq!(signature_accidental(1, Letter::F), 1);
        assert_eq!(signature_accidental(1, Letter::C), 0);
        assert_eq!(signature_accidental(7, Letter::B), 1);
        assert_eq!(signature_accidental(-1, Letter::B), -1);
        assert_eq!(signature_accidental(-1, Letter::E), 0);
        assert_eq!(signature_accidental(-7, Letter::F), -1);
        assert_eq!(signature_accidental(0, Letter::F), 0);
    }

    #[test]
    fn from_signature_round_trips() {
        for mode in [Mode::Major, Mode::Minor] {
            for sig in -7..=7 {
                let k = Key::from_signature(sig, mode).unwrap();
                assert_eq!(k.signature(), sig);
                assert_eq!(Key::new(k.tonic, k.tonic_accidental, mode), Some(k));
            }
        }
        assert_eq!(Key::from_signature(8, Mode::Major), None);
    }
}

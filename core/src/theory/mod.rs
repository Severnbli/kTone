//! Music theory: frequency <-> MIDI, key-aware note spelling, scale degrees, clefs.
//!
//! CONTRACT – the public API below is consumed by the WASM bindings.
//! Do not change signatures without updating `wasm/` and AGENTS.md.
//! Octaves use scientific pitch notation (C4 = middle C, MIDI 60).

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
        todo!("theory agent")
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

impl Key {
    /// `None` if the key would need more than 7 sharps/flats (e.g. G# major).
    pub fn new(tonic: Letter, tonic_accidental: i8, mode: Mode) -> Option<Key> {
        let _ = (tonic, tonic_accidental, mode);
        todo!("theory agent")
    }

    /// All 30 supported keys, ordered by mode then by signature (-7..=7).
    pub fn all() -> Vec<Key> {
        todo!("theory agent")
    }

    /// Number of sharps (positive) or flats (negative) in the key signature.
    pub fn signature(&self) -> i8 {
        todo!("theory agent")
    }

    /// Spell a MIDI note in this key. Diatonic notes use the key's spelling.
    /// Chromatic notes follow a documented, deterministic rule (raised degrees in
    /// sharp keys, lowered in flat keys, sensible choices in C major / A minor,
    /// raised 7th in minor). Never returns double accidentals for chromatic notes
    /// unless the key itself requires it.
    pub fn spell(&self, midi: i32) -> SpelledNote {
        let _ = midi;
        todo!("theory agent")
    }

    /// 1..=7 if `note` is diatonic in this key (exact spelling match), otherwise `None`.
    /// In minor the raised 7th also counts as degree 7.
    pub fn scale_degree(&self, note: &SpelledNote) -> Option<u8> {
        let _ = note;
        todo!("theory agent")
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

impl Clef {
    /// Vertical position on the 5-line staff in diatonic steps:
    /// 0 = bottom line, 1 = first space, ..., 8 = top line.
    /// Negative / >8 values need ledger lines.
    pub fn staff_step(&self, note: &SpelledNote) -> i32 {
        let _ = note;
        todo!("theory agent")
    }
}

/// Fractional MIDI number of `frequency_hz` given the A4 reference.
pub fn freq_to_midi(frequency_hz: f32, a4_hz: f32) -> f32 {
    let _ = (frequency_hz, a4_hz);
    todo!("theory agent")
}

/// Frequency in Hz of a (fractional) MIDI number given the A4 reference.
pub fn midi_to_freq(midi: f32, a4_hz: f32) -> f32 {
    let _ = (midi, a4_hz);
    todo!("theory agent")
}

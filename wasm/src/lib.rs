//! WebAssembly bindings for `ktone-core`.
//!
//! The API is deliberately numeric (indices and flat arrays) so that a frame can
//! be processed without creating JS objects on the Rust side. The TypeScript
//! wrapper in `web/src/engine/index.ts` maps it to the `Analyzer` contract.

use ktone_core::pitch::{PitchTracker, TrackerConfig};
use ktone_core::theory::{Clef, Key, Letter, Mode, SpelledNote};
use wasm_bindgen::prelude::*;

/// Number of `f64` slots written by [`Analyzer::process`].
pub const FRAME_FIELDS: usize = 12;

const LETTERS: [Letter; 7] = [
    Letter::C,
    Letter::D,
    Letter::E,
    Letter::F,
    Letter::G,
    Letter::A,
    Letter::B,
];

fn letter_from_index(index: u8) -> Option<Letter> {
    LETTERS.get(index as usize).copied()
}

fn letter_index(letter: Letter) -> u8 {
    LETTERS.iter().position(|&l| l == letter).unwrap_or(0) as u8
}

fn mode_from_index(index: u8) -> Mode {
    if index == 1 {
        Mode::Minor
    } else {
        Mode::Major
    }
}

fn clef_from_index(index: u8) -> Clef {
    match index {
        1 => Clef::Treble8vb,
        2 => Clef::Bass,
        3 => Clef::Alto,
        4 => Clef::Tenor,
        _ => Clef::Treble,
    }
}

fn key_from_parts(tonic: u8, accidental: i8, mode: u8) -> Option<Key> {
    Key::new(letter_from_index(tonic)?, accidental, mode_from_index(mode))
}

fn c_major() -> Key {
    Key::new(Letter::C, 0, Mode::Major).expect("C major is always valid")
}

/// Real-time analyzer: pitch tracking + key-aware spelling for one audio stream.
#[wasm_bindgen]
pub struct Analyzer {
    tracker: PitchTracker,
    frame_size: usize,
    hop_size: usize,
    key: Key,
    clef: Clef,
    a4_hz: f32,
}

#[wasm_bindgen]
impl Analyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: f32, frame_size: usize, hop_size: usize) -> Analyzer {
        Analyzer {
            tracker: PitchTracker::new(sample_rate, frame_size, TrackerConfig::default()),
            frame_size,
            hop_size,
            key: c_major(),
            clef: Clef::Treble,
            a4_hz: 440.0,
        }
    }

    #[wasm_bindgen(getter, js_name = frameSize)]
    pub fn frame_size(&self) -> usize {
        self.frame_size
    }

    #[wasm_bindgen(getter, js_name = hopSize)]
    pub fn hop_size(&self) -> usize {
        self.hop_size
    }

    /// Letters are indexed C=0 .. B=6, modes major=0 / minor=1,
    /// clefs treble=0, treble8vb=1, bass=2, alto=3, tenor=4.
    /// Returns false (and keeps the previous key) if the key is not supported.
    pub fn configure(
        &mut self,
        tonic: u8,
        accidental: i8,
        mode: u8,
        clef: u8,
        a4_hz: f32,
    ) -> bool {
        self.clef = clef_from_index(clef);
        if a4_hz.is_finite() && a4_hz > 0.0 && (a4_hz - self.a4_hz).abs() > f32::EPSILON {
            self.a4_hz = a4_hz;
            self.tracker.reset();
        }
        match key_from_parts(tonic, accidental, mode) {
            Some(key) => {
                self.key = key;
                true
            }
            None => false,
        }
    }

    /// Processes one frame and writes [`FRAME_FIELDS`] values into `out`:
    /// `[frequencyHz, midi, stableMidi, cents, clarity, rms,
    ///   letter, accidental, octave, degree (0 = out of key), inKey (0/1), staffStep]`.
    /// Returns false (leaving `out` untouched) while silent or unpitched.
    pub fn process(&mut self, frame: &[f32], out: &mut [f64]) -> bool {
        if out.len() < FRAME_FIELDS {
            return false;
        }
        let Some(pitch) = self.tracker.process(frame, self.a4_hz) else {
            return false;
        };
        let note = self.key.spell(pitch.stable_midi);
        let degree = self.key.scale_degree(&note);
        out[0] = pitch.frequency_hz as f64;
        out[1] = pitch.midi as f64;
        out[2] = pitch.stable_midi as f64;
        out[3] = pitch.cents as f64;
        out[4] = pitch.clarity as f64;
        out[5] = pitch.rms as f64;
        write_note(&note, &mut out[6..9]);
        out[9] = degree.map_or(0.0, f64::from);
        out[10] = if degree.is_some() { 1.0 } else { 0.0 };
        out[11] = self.clef.staff_step(&note) as f64;
        true
    }

    /// Spells `midi` in the configured key: `[letter, accidental, octave]`.
    pub fn spell(&self, midi: i32) -> Vec<i32> {
        let note = self.key.spell(midi);
        vec![letter_index(note.letter) as i32, note.accidental as i32, note.octave]
    }

    /// Clears smoothing history.
    pub fn reset(&mut self) {
        self.tracker.reset();
    }
}

fn write_note(note: &SpelledNote, out: &mut [f64]) {
    out[0] = letter_index(note.letter) as f64;
    out[1] = note.accidental as f64;
    out[2] = note.octave as f64;
}

/// All supported keys as flat triplets `[tonic, accidental, mode, ...]`.
#[wasm_bindgen(js_name = allKeys)]
pub fn all_keys() -> Vec<i8> {
    Key::all()
        .iter()
        .flat_map(|k| {
            [
                letter_index(k.tonic) as i8,
                k.tonic_accidental,
                if k.mode == Mode::Minor { 1 } else { 0 },
            ]
        })
        .collect()
}

/// Sharps (positive) or flats (negative) in the key signature; 0 for unsupported keys.
#[wasm_bindgen(js_name = keySignature)]
pub fn key_signature(tonic: u8, accidental: i8, mode: u8) -> i8 {
    key_from_parts(tonic, accidental, mode).map_or(0, |k| k.signature())
}

/// Number of `f64` slots `Analyzer::process` needs.
#[wasm_bindgen(js_name = frameFields)]
pub fn frame_fields() -> usize {
    FRAME_FIELDS
}

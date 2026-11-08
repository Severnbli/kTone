// Small, engine-independent music theory helpers used by the UI (staff layout,
// pitch curve labels, drone) and by the mock analyzer. Internally everything is
// MIDI numbers / scientific pitch notation; naming lives in `naming.ts`.

import type { ClefId, KeySpec, Letter, SpelledNote } from '../engine/types';

export const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

/** Pitch class of each natural letter. */
export const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Order in which sharps are added to a key signature (flats use the reverse). */
export const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
export const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F'];

/** Position of each natural letter on the circle of fifths relative to C. */
const LETTER_FIFTHS: Record<Letter, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function letterIndex(letter: Letter): number {
  return LETTERS.indexOf(letter);
}

/** Sharps (positive) or flats (negative) in the key signature. */
export function keySignature(key: KeySpec): number {
  return LETTER_FIFTHS[key.tonic] + 7 * key.accidental - (key.mode === 'minor' ? 3 : 0);
}

/** Accidental the key signature applies to `letter` (-1, 0 or 1). */
export function signatureAccidental(signature: number, letter: Letter): number {
  if (signature > 0) return SHARP_ORDER.indexOf(letter) < signature ? 1 : 0;
  if (signature < 0) return FLAT_ORDER.indexOf(letter) < -signature ? -1 : 0;
  return 0;
}

export interface ScaleNote {
  letter: Letter;
  accidental: number;
  pc: number;
}

/** The seven diatonic notes of the key, starting on the tonic (natural minor for minor keys). */
export function scaleOf(key: KeySpec): ScaleNote[] {
  const sig = keySignature(key);
  const start = letterIndex(key.tonic);
  const out: ScaleNote[] = [];
  for (let i = 0; i < 7; i++) {
    const letter = LETTERS[(start + i) % 7];
    const accidental = signatureAccidental(sig, letter);
    out.push({ letter, accidental, pc: mod(LETTER_PC[letter] + accidental, 12) });
  }
  return out;
}

/** MIDI number of a spelled note (C4 = 60). */
export function spelledToMidi(note: SpelledNote): number {
  return 12 * (note.octave + 1) + LETTER_PC[note.letter] + note.accidental;
}

/** Pitch class of the key's tonic. */
export function tonicPc(key: KeySpec): number {
  return mod(LETTER_PC[key.tonic] + key.accidental, 12);
}

/** Convert frequency to fractional MIDI for the given reference. */
export function hzToMidi(hz: number, a4Hz: number): number {
  return 69 + 12 * Math.log2(hz / a4Hz);
}

export function midiToHz(midi: number, a4Hz: number): number {
  return a4Hz * Math.pow(2, (midi - 69) / 12);
}

/** Diatonic step of the bottom staff line for each clef (octave * 7 + letter index). */
const CLEF_BOTTOM_LINE: Record<ClefId, number> = {
  treble: 4 * 7 + 2, // E4
  treble8vb: 3 * 7 + 2, // E3 (written E4, sounds an octave lower)
  bass: 2 * 7 + 4, // G2
  alto: 3 * 7 + 3, // F3
  tenor: 3 * 7 + 1, // D3
};

/** Staff position for the clef: 0 = bottom line, 8 = top line, odd = spaces. */
export function staffStepFor(note: SpelledNote, clef: ClefId): number {
  return note.octave * 7 + letterIndex(note.letter) - CLEF_BOTTOM_LINE[clef];
}

const TREBLE_SHARPS = [8, 5, 9, 6, 3, 7, 4];
const TREBLE_FLATS = [4, 7, 3, 6, 2, 5, 1];
const shift = (steps: number[], by: number) => steps.map((s) => s + by);

/** Conventional staff positions of key signature accidentals, in signature order. */
const SIGNATURE_STEPS: Record<ClefId, { sharps: number[]; flats: number[] }> = {
  treble: { sharps: TREBLE_SHARPS, flats: TREBLE_FLATS },
  treble8vb: { sharps: TREBLE_SHARPS, flats: TREBLE_FLATS },
  bass: { sharps: shift(TREBLE_SHARPS, -2), flats: shift(TREBLE_FLATS, -2) },
  alto: { sharps: shift(TREBLE_SHARPS, -1), flats: shift(TREBLE_FLATS, -1) },
  // Tenor clef sharps use the special low zigzag so F♯ does not sit above the staff.
  tenor: { sharps: [2, 6, 3, 7, 4, 8, 5], flats: shift(TREBLE_FLATS, 1) },
};

export interface SignatureGlyph {
  step: number;
  accidental: 1 | -1;
}

export function signatureLayout(signature: number, clef: ClefId): SignatureGlyph[] {
  const table = SIGNATURE_STEPS[clef];
  if (signature > 0) {
    return table.sharps.slice(0, signature).map((step) => ({ step, accidental: 1 }));
  }
  if (signature < 0) {
    return table.flats.slice(0, -signature).map((step) => ({ step, accidental: -1 }));
  }
  return [];
}

/** Staff steps of the ledger lines a note at `step` needs. */
export function ledgerLines(step: number): number[] {
  const out: number[] = [];
  for (let s = -2; s >= step; s -= 2) out.push(s);
  for (let s = 10; s <= step; s += 2) out.push(s);
  return out;
}

export function sameKey(a: KeySpec, b: KeySpec): boolean {
  return a.tonic === b.tonic && a.accidental === b.accidental && a.mode === b.mode;
}

export function keyId(key: KeySpec): string {
  const acc = key.accidental > 0 ? '#' : key.accidental < 0 ? 'b' : '';
  return `${key.tonic}${acc}-${key.mode}`;
}

export function parseKeyId(id: string): KeySpec | null {
  const m = /^([A-G])([#b]?)-(major|minor)$/.exec(id);
  if (!m) return null;
  return {
    tonic: m[1] as Letter,
    accidental: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0,
    mode: m[3] as KeySpec['mode'],
  };
}

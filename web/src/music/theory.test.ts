import { describe, expect, it } from 'vitest';
import type { KeySpec } from '../engine/types';
import { ALL_KEYS } from './keys';
import {
  keyId,
  keySignature,
  ledgerLines,
  parseKeyId,
  scaleOf,
  signatureAccidental,
  signatureLayout,
  spelledToMidi,
  staffStepFor,
} from './theory';

const key = (tonic: KeySpec['tonic'], accidental: number, mode: KeySpec['mode']): KeySpec => ({
  tonic,
  accidental,
  mode,
});

describe('keySignature', () => {
  it('computes sharps and flats', () => {
    expect(keySignature(key('C', 0, 'major'))).toBe(0);
    expect(keySignature(key('D', 0, 'major'))).toBe(2);
    expect(keySignature(key('D', -1, 'major'))).toBe(-5);
    expect(keySignature(key('C', 1, 'major'))).toBe(7);
    expect(keySignature(key('C', -1, 'major'))).toBe(-7);
    expect(keySignature(key('B', 0, 'minor'))).toBe(2);
    expect(keySignature(key('A', 1, 'minor'))).toBe(7);
    expect(keySignature(key('A', -1, 'minor'))).toBe(-7);
  });

  it('covers -7..7 for both modes', () => {
    const sigs = ALL_KEYS.map(keySignature).sort((a, b) => a - b);
    const expected = [...Array(15).keys()].map((i) => i - 7);
    expect(sigs).toEqual([...expected, ...expected].sort((a, b) => a - b));
  });
});

describe('scaleOf', () => {
  it('spells D major with F♯ and C♯', () => {
    expect(scaleOf(key('D', 0, 'major')).map((n) => n.letter + n.accidental)).toEqual([
      'D0',
      'E0',
      'F1',
      'G0',
      'A0',
      'B0',
      'C1',
    ]);
  });
  it('spells D♭ major with G♭', () => {
    const s = scaleOf(key('D', -1, 'major'));
    expect(s[3]).toMatchObject({ letter: 'G', accidental: -1, pc: 6 });
  });
  it('natural minor', () => {
    expect(scaleOf(key('A', 0, 'minor')).every((n) => n.accidental === 0)).toBe(true);
  });
});

describe('signatureAccidental', () => {
  it('applies the signature order', () => {
    expect(signatureAccidental(2, 'F')).toBe(1);
    expect(signatureAccidental(2, 'C')).toBe(1);
    expect(signatureAccidental(2, 'G')).toBe(0);
    expect(signatureAccidental(-1, 'B')).toBe(-1);
    expect(signatureAccidental(-1, 'E')).toBe(0);
  });
});

describe('staff positions', () => {
  it('maps notes to clef staff steps', () => {
    expect(staffStepFor({ letter: 'E', accidental: 0, octave: 4 }, 'treble')).toBe(0);
    expect(staffStepFor({ letter: 'F', accidental: 0, octave: 5 }, 'treble')).toBe(8);
    expect(staffStepFor({ letter: 'C', accidental: 0, octave: 4 }, 'treble')).toBe(-2);
    expect(staffStepFor({ letter: 'G', accidental: 0, octave: 2 }, 'bass')).toBe(0);
    expect(staffStepFor({ letter: 'C', accidental: 0, octave: 4 }, 'bass')).toBe(10);
    expect(staffStepFor({ letter: 'C', accidental: 0, octave: 4 }, 'alto')).toBe(4);
    expect(staffStepFor({ letter: 'C', accidental: 0, octave: 4 }, 'tenor')).toBe(6);
    expect(staffStepFor({ letter: 'E', accidental: 0, octave: 3 }, 'treble8vb')).toBe(0);
  });

  it('ledger lines below and above', () => {
    expect(ledgerLines(4)).toEqual([]);
    expect(ledgerLines(-1)).toEqual([]);
    expect(ledgerLines(-2)).toEqual([-2]);
    expect(ledgerLines(-5)).toEqual([-2, -4]);
    expect(ledgerLines(9)).toEqual([]);
    expect(ledgerLines(12)).toEqual([10, 12]);
  });

  it('places key signatures conventionally', () => {
    expect(signatureLayout(2, 'treble')).toEqual([
      { step: 8, accidental: 1 },
      { step: 5, accidental: 1 },
    ]);
    expect(signatureLayout(-3, 'bass').map((g) => g.step)).toEqual([2, 5, 1]);
    expect(signatureLayout(7, 'tenor').map((g) => g.step)).toEqual([2, 6, 3, 7, 4, 8, 5]);
    expect(signatureLayout(1, 'alto')).toEqual([{ step: 7, accidental: 1 }]);
    expect(signatureLayout(0, 'treble')).toEqual([]);
  });
});

describe('ids and midi', () => {
  it('round-trips key ids', () => {
    for (const k of ALL_KEYS) expect(parseKeyId(keyId(k))).toEqual(k);
    expect(parseKeyId('H-major')).toBeNull();
  });
  it('spelledToMidi handles enharmonics across octave boundaries', () => {
    expect(spelledToMidi({ letter: 'A', accidental: 0, octave: 4 })).toBe(69);
    expect(spelledToMidi({ letter: 'B', accidental: 1, octave: 3 })).toBe(60);
    expect(spelledToMidi({ letter: 'C', accidental: -1, octave: 4 })).toBe(59);
  });
});

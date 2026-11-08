import { describe, expect, it } from 'vitest';
import {
  accidentalGlyph,
  formatDegree,
  formatNote,
  keyLabel,
  pitchName,
  russianOctave,
} from './naming';
import { ALL_KEYS, MAJOR_KEYS, MINOR_KEYS } from './keys';

describe('accidentalGlyph', () => {
  it('maps -2..2 to Unicode glyphs', () => {
    expect([-2, -1, 0, 1, 2].map(accidentalGlyph)).toEqual(['𝄫', '♭', '', '♯', '𝄪']);
  });
});

describe('russianOctave', () => {
  it('names all octaves from субконтр to пятая', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8].map(russianOctave)).toEqual([
      'субконтроктавы',
      'контроктавы',
      'большой октавы',
      'малой октавы',
      'первой октавы',
      'второй октавы',
      'третьей октавы',
      'четвёртой октавы',
      'пятой октавы',
    ]);
  });
});

describe('formatNote', () => {
  it('solfège with Russian octaves: A4 = ля первой октавы, C3 = до малой октавы', () => {
    expect(formatNote({ letter: 'A', accidental: 0, octave: 4 }, 'solfege', 'ru').full).toBe(
      'ля первой октавы',
    );
    expect(formatNote({ letter: 'C', accidental: 0, octave: 3 }, 'solfege', 'ru').full).toBe(
      'до малой октавы',
    );
    expect(formatNote({ letter: 'C', accidental: 0, octave: 4 }, 'solfege', 'ru').full).toBe(
      'до первой октавы',
    );
  });

  it('solfège with accidentals', () => {
    const f = formatNote({ letter: 'F', accidental: 1, octave: 4 }, 'solfege', 'ru');
    expect(f).toMatchObject({ name: 'фа', accidental: '♯', short: 'фа♯' });
    expect(f.full).toBe('фа-диез первой октавы');
    expect(formatNote({ letter: 'G', accidental: -1, octave: 2 }, 'solfege', 'ru').full).toBe(
      'соль-бемоль большой октавы',
    );
    expect(formatNote({ letter: 'F', accidental: 2, octave: 5 }, 'solfege', 'ru').full).toBe(
      'фа-дубль-диез второй октавы',
    );
    expect(formatNote({ letter: 'B', accidental: -2, octave: 1 }, 'solfege', 'ru').full).toBe(
      'си-дубль-бемоль контроктавы',
    );
  });

  it('letter names with scientific octave', () => {
    expect(formatNote({ letter: 'A', accidental: 0, octave: 4 }, 'letter', 'ru').full).toBe('A4');
    expect(formatNote({ letter: 'G', accidental: -1, octave: 3 }, 'letter', 'en')).toMatchObject({
      name: 'G',
      accidental: '♭',
      octave: '3',
      full: 'G♭3',
    });
    expect(formatNote({ letter: 'C', accidental: 2, octave: 5 }, 'letter', 'en').full).toBe('C𝄪5');
  });

  it('English solfège uses scientific octave numbers', () => {
    expect(formatNote({ letter: 'G', accidental: 0, octave: 4 }, 'solfege', 'en').full).toBe(
      'sol4',
    );
  });

  it('pitchName drops the octave', () => {
    expect(pitchName({ letter: 'B', accidental: -1 }, 'solfege', 'ru')).toBe('си♭');
    expect(pitchName({ letter: 'B', accidental: -1 }, 'letter', 'ru')).toBe('B♭');
  });
});

describe('formatDegree', () => {
  it('roman and arabic', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map((d) => formatDegree(d, 'roman'))).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
      'VI',
      'VII',
    ]);
    expect(formatDegree(5, 'arabic')).toBe('5');
  });
});

describe('key list labels', () => {
  it('has 30 unique keys, 15 major and 15 minor', () => {
    expect(MAJOR_KEYS).toHaveLength(15);
    expect(MINOR_KEYS).toHaveLength(15);
    const labels = ALL_KEYS.map((k) => keyLabel(k, 'ru'));
    expect(new Set(labels).size).toBe(30);
  });

  it('uses Russian conventions: capitalized major, lowercase minor', () => {
    expect(keyLabel({ tonic: 'D', accidental: 0, mode: 'major' }, 'ru')).toBe('Ре мажор');
    expect(keyLabel({ tonic: 'B', accidental: 0, mode: 'minor' }, 'ru')).toBe('си минор');
    expect(keyLabel({ tonic: 'F', accidental: 1, mode: 'major' }, 'ru')).toBe('Фа-диез мажор');
    expect(keyLabel({ tonic: 'E', accidental: -1, mode: 'minor' }, 'ru')).toBe('ми-бемоль минор');
    expect(keyLabel({ tonic: 'G', accidental: 0, mode: 'major' }, 'ru')).toBe('Соль мажор');
  });

  it('English labels', () => {
    expect(keyLabel({ tonic: 'D', accidental: -1, mode: 'major' }, 'en')).toBe('D♭ major');
    expect(keyLabel({ tonic: 'G', accidental: 1, mode: 'minor' }, 'en')).toBe('G♯ minor');
  });
});

// Presentation of notes, keys and degrees. Pure functions, no React.

import type { KeySpec, Letter, SpelledNote } from '../engine/types';
import type { Lang } from '../i18n/strings';

export type NoteNaming = 'solfege' | 'letter';
export type DegreeStyle = 'roman' | 'arabic';

const SOLFEGE: Record<Lang, Record<Letter, string>> = {
  ru: { C: 'до', D: 'ре', E: 'ми', F: 'фа', G: 'соль', A: 'ля', B: 'си' },
  en: { C: 'do', D: 're', E: 'mi', F: 'fa', G: 'sol', A: 'la', B: 'si' },
};

/** Unicode glyph for an accidental (-2..2). Natural is an empty string. */
export function accidentalGlyph(accidental: number): string {
  switch (accidental) {
    case 2:
      return '𝄪';
    case 1:
      return '♯';
    case -1:
      return '♭';
    case -2:
      return '𝄫';
    default:
      return '';
  }
}

const RU_ACCIDENTAL_WORD: Record<number, string> = {
  2: 'дубль-диез',
  1: 'диез',
  [-1]: 'бемоль',
  [-2]: 'дубль-бемоль',
};

/** Russian octave names in the genitive case, indexed by scientific octave (0..8). */
const RU_OCTAVES_GENITIVE = [
  'субконтроктавы',
  'контроктавы',
  'большой октавы',
  'малой октавы',
  'первой октавы',
  'второй октавы',
  'третьей октавы',
  'четвёртой октавы',
  'пятой октавы',
];

/** Russian octave name for a scientific octave number (C4 = до первой октавы). */
export function russianOctave(octave: number): string {
  return RU_OCTAVES_GENITIVE[octave] ?? `${octave}`;
}

export function letterName(letter: Letter, naming: NoteNaming, lang: Lang): string {
  return naming === 'letter' ? letter : SOLFEGE[lang][letter];
}

export interface FormattedNote {
  /** Name without accidental: «ля», «A». */
  name: string;
  /** Accidental glyph or empty string. */
  accidental: string;
  /** «первой октавы» for Russian solfège, otherwise the scientific octave number. */
  octave: string;
  /** Name with accidental, no octave: «ля♯», «A♯». */
  short: string;
  /** Full, readable form: «ля-диез первой октавы», «A♯4». */
  full: string;
}

export function formatNote(note: SpelledNote, naming: NoteNaming, lang: Lang): FormattedNote {
  const name = letterName(note.letter, naming, lang);
  const accidental = accidentalGlyph(note.accidental);
  if (naming === 'solfege' && lang === 'ru') {
    const octave = russianOctave(note.octave);
    const word = RU_ACCIDENTAL_WORD[note.accidental];
    return {
      name,
      accidental,
      octave,
      short: name + accidental,
      full: `${word ? `${name}-${word}` : name} ${octave}`,
    };
  }
  const octave = String(note.octave);
  return {
    name,
    accidental,
    octave,
    short: name + accidental,
    full: `${name}${accidental}${octave}`,
  };
}

/** Pitch class name without octave: «фа♯», «F♯». */
export function pitchName(
  note: Pick<SpelledNote, 'letter' | 'accidental'>,
  naming: NoteNaming,
  lang: Lang,
): string {
  return letterName(note.letter, naming, lang) + accidentalGlyph(note.accidental);
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

export function formatDegree(degree: number, style: DegreeStyle): string {
  return style === 'roman' ? (ROMAN[degree - 1] ?? '') : String(degree);
}

const RU_ACCIDENTAL_KEY: Record<number, string> = { 1: '-диез', [-1]: '-бемоль', 0: '' };

/** «Ре мажор», «си минор», «Фа-диез мажор», «ми-бемоль минор»; English: «D major». */
export function keyLabel(key: KeySpec, lang: Lang): string {
  if (lang === 'ru') {
    const tonic = SOLFEGE.ru[key.tonic] + RU_ACCIDENTAL_KEY[key.accidental];
    if (key.mode === 'major') return `${tonic[0].toUpperCase()}${tonic.slice(1)} мажор`;
    return `${tonic} минор`;
  }
  return `${key.tonic}${accidentalGlyph(key.accidental)} ${key.mode}`;
}

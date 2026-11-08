import type { KeySpec, Letter } from '../engine/types';

const k = (tonic: Letter, accidental: number, mode: KeySpec['mode']): KeySpec => ({
  tonic,
  accidental,
  mode,
});

/** The 15 major keys ordered by key signature (7 flats .. 7 sharps). */
export const MAJOR_KEYS: readonly KeySpec[] = [
  k('C', -1, 'major'),
  k('G', -1, 'major'),
  k('D', -1, 'major'),
  k('A', -1, 'major'),
  k('E', -1, 'major'),
  k('B', -1, 'major'),
  k('F', 0, 'major'),
  k('C', 0, 'major'),
  k('G', 0, 'major'),
  k('D', 0, 'major'),
  k('A', 0, 'major'),
  k('E', 0, 'major'),
  k('B', 0, 'major'),
  k('F', 1, 'major'),
  k('C', 1, 'major'),
];

/** The 15 minor keys ordered by key signature (7 flats .. 7 sharps). */
export const MINOR_KEYS: readonly KeySpec[] = [
  k('A', -1, 'minor'),
  k('E', -1, 'minor'),
  k('B', -1, 'minor'),
  k('F', 0, 'minor'),
  k('C', 0, 'minor'),
  k('G', 0, 'minor'),
  k('D', 0, 'minor'),
  k('A', 0, 'minor'),
  k('E', 0, 'minor'),
  k('B', 0, 'minor'),
  k('F', 1, 'minor'),
  k('C', 1, 'minor'),
  k('G', 1, 'minor'),
  k('D', 1, 'minor'),
  k('A', 1, 'minor'),
];

export const ALL_KEYS: readonly KeySpec[] = [...MAJOR_KEYS, ...MINOR_KEYS];

export const DEFAULT_KEY: KeySpec = k('C', 0, 'major');

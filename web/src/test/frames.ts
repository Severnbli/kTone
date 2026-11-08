import type { PitchFrame } from '../engine/types';

/** Build a PitchFrame for tests (defaults: A4 in C major on the treble staff). */
export function frame(stableMidi: number, cents = 0, extra: Partial<PitchFrame> = {}): PitchFrame {
  return {
    frequencyHz: 440 * Math.pow(2, (stableMidi + cents / 100 - 69) / 12),
    midi: stableMidi + cents / 100,
    stableMidi,
    cents,
    clarity: 0.95,
    rms: 0.2,
    note: { letter: 'A', accidental: 0, octave: 4 },
    degree: 6,
    inKey: true,
    staffStep: 3,
    ...extra,
  };
}

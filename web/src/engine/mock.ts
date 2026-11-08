// Pure-TS stand-in for the Rust/WASM analyzer. Used by unit tests and as a
// fallback. Pitch detection is a plain YIN (cumulative mean normalized
// difference); spelling is simple and key-aware: diatonic notes use the key's
// spelling, chromatic notes use sharps in sharp keys (and C/a) and flats in flat
// keys.

import type {
  Analyzer,
  AnalyzerFactory,
  AnalyzerSettings,
  KeySpec,
  Letter,
  PitchFrame,
  SpelledNote,
} from './types';
import { ALL_KEYS, DEFAULT_KEY } from '../music/keys';
import { LETTER_PC, hzToMidi, keySignature, mod, scaleOf, staffStepFor } from '../music/theory';

export const FRAME_SIZE = 2048;
export const HOP_SIZE = 512;

const MIN_HZ = 60;
const MAX_HZ = 1500;
const YIN_THRESHOLD = 0.15;
const SILENCE_RMS = 0.01;
/** Extra cents past the half-semitone boundary before the stable note changes. */
const HYSTERESIS_CENTS = 15;

const SHARP_NAMES: [Letter, number][] = [
  ['C', 0],
  ['C', 1],
  ['D', 0],
  ['D', 1],
  ['E', 0],
  ['F', 0],
  ['F', 1],
  ['G', 0],
  ['G', 1],
  ['A', 0],
  ['A', 1],
  ['B', 0],
];
const FLAT_NAMES: [Letter, number][] = [
  ['C', 0],
  ['D', -1],
  ['D', 0],
  ['E', -1],
  ['E', 0],
  ['F', 0],
  ['G', -1],
  ['G', 0],
  ['A', -1],
  ['A', 0],
  ['B', -1],
  ['B', 0],
];

export function spellInKey(midi: number, key: KeySpec): SpelledNote {
  const m = Math.round(midi);
  const pc = mod(m, 12);
  const scale = scaleOf(key);
  const diatonic = scale.find((n) => n.pc === pc);
  let letter: Letter;
  let accidental: number;
  if (diatonic) {
    letter = diatonic.letter;
    accidental = diatonic.accidental;
  } else {
    [letter, accidental] = (keySignature(key) >= 0 ? SHARP_NAMES : FLAT_NAMES)[pc];
  }
  const octave = Math.floor((m - LETTER_PC[letter] - accidental) / 12) - 1;
  return { letter, accidental, octave };
}

export function degreeInKey(midi: number, key: KeySpec): number | null {
  const pc = mod(Math.round(midi), 12);
  const idx = scaleOf(key).findIndex((n) => n.pc === pc);
  return idx < 0 ? null : idx + 1;
}

/** YIN pitch estimate. Returns [frequencyHz, clarity] or null when unpitched. */
export function detectPitch(
  frame: Float32Array,
  sampleRate: number,
  diff: Float32Array = new Float32Array(frame.length / 2),
): [number, number] | null {
  const w = frame.length >> 1;
  const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
  const maxLag = Math.min(w - 1, Math.ceil(sampleRate / MIN_HZ));
  diff[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0;
    for (let i = 0; i < w; i++) {
      const d = frame[i] - frame[i + tau];
      sum += d * d;
    }
    running += sum;
    diff[tau] = running > 0 ? (sum * tau) / running : 1;
  }
  let tau = minLag;
  for (; tau <= maxLag; tau++) {
    if (diff[tau] < YIN_THRESHOLD) {
      while (tau + 1 <= maxLag && diff[tau + 1] < diff[tau]) tau++;
      break;
    }
  }
  if (tau > maxLag) return null;
  // Parabolic interpolation around the minimum.
  let betterTau = tau;
  if (tau > 1 && tau < maxLag) {
    const a = diff[tau - 1];
    const b = diff[tau];
    const c = diff[tau + 1];
    const denom = a + c - 2 * b;
    if (denom !== 0) betterTau = tau + (a - c) / (2 * denom);
  }
  return [sampleRate / betterTau, Math.max(0, Math.min(1, 1 - diff[tau]))];
}

class MockAnalyzer implements Analyzer {
  readonly frameSize = FRAME_SIZE;
  readonly hopSize = HOP_SIZE;
  private settings: AnalyzerSettings = { key: DEFAULT_KEY, clef: 'treble', a4Hz: 440 };
  private stableMidi: number | null = null;
  private readonly diff = new Float32Array(FRAME_SIZE / 2);

  constructor(private readonly sampleRate: number) {}

  configure(settings: AnalyzerSettings): void {
    if (settings.a4Hz !== this.settings.a4Hz) this.stableMidi = null;
    this.settings = { ...settings, key: { ...settings.key } };
  }

  process(frame: Float32Array): PitchFrame | null {
    if (frame.length !== this.frameSize) {
      throw new Error(`frame.length must be ${this.frameSize}, got ${frame.length}`);
    }
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    const rms = Math.sqrt(energy / frame.length);
    if (rms < SILENCE_RMS) return null;
    const pitch = detectPitch(frame, this.sampleRate, this.diff);
    if (!pitch) return null;
    const [frequencyHz, clarity] = pitch;
    const midi = hzToMidi(frequencyHz, this.settings.a4Hz);
    if (
      this.stableMidi === null ||
      Math.abs(midi - this.stableMidi) * 100 > 50 + HYSTERESIS_CENTS
    ) {
      this.stableMidi = Math.round(midi);
    }
    const stableMidi = this.stableMidi;
    const note = this.spell(stableMidi);
    const degree = degreeInKey(stableMidi, this.settings.key);
    return {
      frequencyHz,
      midi,
      stableMidi,
      cents: (midi - stableMidi) * 100,
      clarity,
      rms,
      note,
      degree,
      inKey: degree !== null,
      staffStep: staffStepFor(note, this.settings.clef),
    };
  }

  keys(): KeySpec[] {
    return ALL_KEYS.map((k) => ({ ...k }));
  }

  signature(key: KeySpec): number {
    return keySignature(key);
  }

  spell(midi: number): SpelledNote {
    return spellInKey(midi, this.settings.key);
  }

  dispose(): void {
    this.stableMidi = null;
  }
}

export const createMockAnalyzer: AnalyzerFactory = async (sampleRate) =>
  new MockAnalyzer(sampleRate);

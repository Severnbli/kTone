// Pure-TS stand-in for the Rust/WASM analyzer. Used by unit tests and as a
// fallback. Pitch detection is a plain YIN (cumulative mean normalized
// difference); spelling is simple and key-aware: diatonic notes use the key's
// spelling, chromatic notes use sharps in sharp keys (and C/a) and flats in flat
// keys. The drone filter is a port of the Rust one (see `droneCheck.ts`), and
// so is the automatic noise gate (see `noiseFloor.ts`).

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
import { DroneChecker } from './droneCheck';
import { NoiseFloor } from './noiseFloor';
import { LETTER_PC, hzToMidi, keySignature, mod, scaleOf, staffStepFor } from '../music/theory';

export const FRAME_SIZE = 2048;
export const HOP_SIZE = 512;

const MIN_HZ = 60;
const MAX_HZ = 1500;
const YIN_THRESHOLD = 0.15;
/** Extra cents past the half-semitone boundary before the stable note changes. */
const HYSTERESIS_CENTS = 15;
/** Vibrato-center window, as in the Rust core (`CENTER_WINDOW_SECS`). */
const CENTER_WINDOW_SECS = 0.3;
/** Unpitched frames in a row after which the center history is dropped. */
const GAP_RESET_FRAMES = 4;
/**
 * The center is ready after 3/5 of its window, or after this many frames
 * within `CENTER_READY_SPREAD` semitones (as in the Rust core).
 */
const CENTER_READY_MIN_FRAMES = 6;
const CENTER_READY_SPREAD = 0.08;
/** Samples at or below this magnitude are digital silence (as in the Rust core). */
const DIGITAL_SILENCE = 1e-6;
/**
 * Frames that start or end with this many silent samples are not analyzed:
 * the stream had not started yet or dropped out (`MIN_SILENT_RUN` in the core).
 */
const MIN_SILENT_RUN = 16;

/** True when `frame` starts or ends with `MIN_SILENT_RUN` digitally silent samples. */
export function hasSilentEdge(frame: Float32Array): boolean {
  const n = frame.length;
  if (n < MIN_SILENT_RUN) return false;
  let lead = true;
  let trail = true;
  for (let i = 0; i < MIN_SILENT_RUN; i++) {
    lead &&= Math.abs(frame[i]) <= DIGITAL_SILENCE;
    trail &&= Math.abs(frame[n - 1 - i]) <= DIGITAL_SILENCE;
  }
  return lead || trail;
}

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
  /** Ring of recent MIDI values of the current note for the vibrato center. */
  private readonly centerHist: Float64Array;
  private centerLen = 0;
  private centerPos = 0;
  private centerReady = false;
  private invalidRun = 0;
  private droneHz = 0;
  private droneFilter = false;
  private readonly droneChecker: DroneChecker;
  private readonly noise: NoiseFloor;
  droneLeak = false;

  constructor(private readonly sampleRate: number) {
    this.droneChecker = new DroneChecker(sampleRate, FRAME_SIZE);
    this.noise = new NoiseFloor(sampleRate, HOP_SIZE);
    const frames = Math.round((CENTER_WINDOW_SECS * sampleRate) / HOP_SIZE);
    this.centerHist = new Float64Array(Math.max(1, Math.min(255, frames || 1)));
  }

  configure(settings: AnalyzerSettings): void {
    if (settings.a4Hz !== this.settings.a4Hz) {
      this.stableMidi = null;
      this.clearCenter();
    }
    this.settings = { ...settings, key: { ...settings.key } };
  }

  get noiseFloor(): number | null {
    return this.noise.floor;
  }

  get gate(): number {
    return this.noise.gate;
  }

  setDrone(hz: number | null, filter: boolean): void {
    this.droneHz = hz !== null && Number.isFinite(hz) && hz > 0 ? hz : 0;
    this.droneFilter = filter;
  }

  private clearCenter(): void {
    this.centerLen = 0;
    this.centerPos = 0;
    this.centerReady = false;
  }

  private unpitched(): null {
    this.invalidRun++;
    if (this.invalidRun >= GAP_RESET_FRAMES) this.clearCenter();
    return null;
  }

  /** See `PitchFrame.centerReady`; latched until the note changes. */
  private isCenterReady(): boolean {
    const len = this.centerLen;
    const cap = this.centerHist.length;
    if (!this.centerReady && 5 * len >= 3 * cap) this.centerReady = true;
    if (!this.centerReady && len >= CENTER_READY_MIN_FRAMES) {
      const oldest = (this.centerPos - len + cap) % cap;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < len; i++) {
        const v = this.centerHist[(oldest + i) % cap];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      this.centerReady = hi - lo <= CENTER_READY_SPREAD;
    }
    return this.centerReady;
  }

  /** Triangular-weighted mean of the center ring (same as the Rust core). */
  private pushCenter(midi: number): number {
    const cap = this.centerHist.length;
    this.centerHist[this.centerPos] = midi;
    this.centerPos = (this.centerPos + 1) % cap;
    this.centerLen = Math.min(this.centerLen + 1, cap);
    const len = this.centerLen;
    const oldest = (this.centerPos - len + cap) % cap;
    let sum = 0;
    let weights = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.min(i + 1, len - i);
      sum += w * this.centerHist[(oldest + i) % cap];
      weights += w;
    }
    return sum / weights;
  }

  process(frame: Float32Array): PitchFrame | null {
    if (frame.length !== this.frameSize) {
      throw new Error(`frame.length must be ${this.frameSize}, got ${frame.length}`);
    }
    this.droneLeak = false;
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    const rms = Math.sqrt(energy / frame.length);
    if (hasSilentEdge(frame)) return this.unpitched();
    const loudEnough = rms >= this.noise.gate;
    // The detector runs below the gate too, so a quiet clear pitch is not learned as noise.
    const pitch = detectPitch(frame, this.sampleRate, this.diff);
    this.noise.push(rms, pitch !== null);
    if (!loudEnough || !pitch) return this.unpitched();
    let [frequencyHz] = pitch;
    const clarity = pitch[1];
    if (this.droneHz > 0) {
      const verdict = this.droneChecker.check(frame, frequencyHz, this.droneHz);
      if (verdict === 'drone') {
        this.droneLeak = true;
        if (this.droneFilter) return this.unpitched();
      } else if (verdict === 'voiceOctaveUp' && this.droneFilter && 2 * frequencyHz <= MAX_HZ) {
        frequencyHz *= 2;
      }
    }
    this.invalidRun = 0;
    const midi = hzToMidi(frequencyHz, this.settings.a4Hz);
    if (
      this.stableMidi === null ||
      Math.abs(midi - this.stableMidi) * 100 > 50 + HYSTERESIS_CENTS
    ) {
      const next = Math.round(midi);
      // A new note: do not drag the center from the previous one.
      if (next !== this.stableMidi) this.clearCenter();
      this.stableMidi = next;
    }
    const stableMidi = this.stableMidi;
    const centerMidi = this.pushCenter(midi);
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
      centerMidi,
      centerCents: (centerMidi - stableMidi) * 100,
      centerReady: this.isCenterReady(),
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
    this.droneLeak = false;
    this.clearCenter();
    this.noise.reset();
  }
}

export const createMockAnalyzer: AnalyzerFactory = async (sampleRate) =>
  new MockAnalyzer(sampleRate);

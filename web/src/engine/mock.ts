// Pure-TS stand-in for the Rust/WASM analyzer. Used by unit tests and as a
// fallback. Pitch detection is a plain YIN (cumulative mean normalized
// difference); spelling is simple and key-aware: diatonic notes use the key's
// spelling, chromatic notes use sharps in sharp keys (and C/a) and flats in flat
// keys. The smoothing and note switching (`noteTracker.ts`), the drone filter
// (`droneCheck.ts`) and the automatic noise gate (`noiseFloor.ts`) are ports
// of the Rust core.

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
import { DRONE_CONFIRM_CENTS, DroneChecker, nearDrone } from './droneCheck';
import { NoteTracker } from './noteTracker';
import { NoiseFloor } from './noiseFloor';
import { LETTER_PC, keySignature, mod, scaleOf, staffStepFor } from '../music/theory';

export const FRAME_SIZE = 2048;
export const HOP_SIZE = 512;

const MIN_HZ = 60;
const MAX_HZ = 1500;
const YIN_THRESHOLD = 0.15;
/**
 * After drone leakage in the last 0.5 s, a pitched frame near the drone is
 * shown only once this many came in a row (`drone_confirm` in the core).
 */
const DRONE_CONFIRM = 5;
const DRONE_LEAK_MEMORY_SECS = 0.5;
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

/** True when `frame` holds `MIN_SILENT_RUN` digitally silent samples in a row anywhere (a dropout). */
export function hasSilentRun(frame: Float32Array): boolean {
  let run = 0;
  for (let i = 0; i < frame.length; i++) {
    run = Math.abs(frame[i]) <= DIGITAL_SILENCE ? run + 1 : 0;
    if (run >= MIN_SILENT_RUN) return true;
  }
  return false;
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
  private readonly diff = new Float32Array(FRAME_SIZE / 2);
  private readonly tracker: NoteTracker;
  /** Frames since drone leakage was last seen, and drone-pitched frames in a row. */
  private sinceLeak = Infinity;
  private droneVoiceRun = 0;
  private readonly droneLeakMemory: number;
  private droneHz = 0;
  private droneFilter = false;
  private readonly droneChecker: DroneChecker;
  private readonly noise: NoiseFloor;
  droneLeak = false;

  constructor(private readonly sampleRate: number) {
    this.droneChecker = new DroneChecker(sampleRate, FRAME_SIZE);
    this.noise = new NoiseFloor(sampleRate, HOP_SIZE);
    this.tracker = new NoteTracker(sampleRate, HOP_SIZE);
    this.droneLeakMemory = Math.round((DRONE_LEAK_MEMORY_SECS * sampleRate) / HOP_SIZE);
  }

  /** A new A4 keeps all state: the tracker re-decides the note on the next frame. */
  configure(settings: AnalyzerSettings): void {
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

  private unpitched(): null {
    this.tracker.invalid();
    return null;
  }

  process(frame: Float32Array): PitchFrame | null {
    if (frame.length !== this.frameSize) {
      throw new Error(`frame.length must be ${this.frameSize}, got ${frame.length}`);
    }
    this.droneLeak = false;
    this.sinceLeak++;
    // Set again below for a drone-pitched frame, so any other frame breaks the run.
    const voiceRun = this.droneVoiceRun;
    this.droneVoiceRun = 0;
    let energy = 0;
    for (let i = 0; i < frame.length; i++) energy += frame[i] * frame[i];
    const rms = Math.sqrt(energy / frame.length);
    if (hasSilentEdge(frame)) return this.unpitched();
    const loudEnough = rms >= this.noise.gate;
    // The detector runs below the gate too, so a quiet clear pitch is not learned as noise.
    const pitch = detectPitch(frame, this.sampleRate, this.diff);
    // A dropout makes the frame quieter than the room: not learned as noise.
    if (!hasSilentRun(frame)) this.noise.push(rms, pitch !== null);
    if (!loudEnough || !pitch) return this.unpitched();
    let [frequencyHz] = pitch;
    const clarity = pitch[1];
    if (this.droneHz > 0) {
      const verdict = this.droneChecker.check(frame, frequencyHz, this.droneHz);
      // A glitch in the input stream makes the leaking drone look like voice
      // while it is in the frame (4 hops): see `drone_confirm` in the core.
      if (verdict !== 'drone' && nearDrone(frequencyHz, this.droneHz, DRONE_CONFIRM_CENTS)) {
        this.droneVoiceRun = voiceRun + 1;
        const recentLeak = this.sinceLeak <= this.droneLeakMemory;
        if (this.droneFilter && recentLeak && this.droneVoiceRun < DRONE_CONFIRM) {
          return this.unpitched();
        }
      }
      if (verdict === 'drone') {
        this.droneLeak = true;
        this.sinceLeak = 0;
        if (this.droneFilter) return this.unpitched();
      } else if (verdict === 'voiceOctaveUp' && this.droneFilter && 2 * frequencyHz <= MAX_HZ) {
        frequencyHz *= 2;
      }
    }
    const tracked = this.tracker.push(frequencyHz, this.settings.a4Hz);
    const { stableMidi, midi, centerMidi } = tracked;
    const note = this.spell(stableMidi);
    const degree = degreeInKey(stableMidi, this.settings.key);
    return {
      frequencyHz: tracked.frequencyHz,
      midi,
      stableMidi,
      cents: tracked.cents,
      clarity,
      rms,
      note,
      degree,
      inKey: degree !== null,
      staffStep: staffStepFor(note, this.settings.clef),
      centerMidi,
      centerCents: tracked.centerCents,
      centerReady: tracked.centerReady,
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
    this.tracker.reset();
    this.droneLeak = false;
    this.sinceLeak = Infinity;
    this.droneVoiceRun = 0;
    this.noise.reset();
  }
}

export const createMockAnalyzer: AnalyzerFactory = async (sampleRate) =>
  new MockAnalyzer(sampleRate);

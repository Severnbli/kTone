// CONTRACT between the UI and the audio engine (Rust core compiled to WASM).
// The WASM bindings in `wasm/` implement `Analyzer`; `mock.ts` implements it in
// pure TS for tests. Do not change without updating both sides.

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Mode = 'major' | 'minor';
export type ClefId = 'treble' | 'treble8vb' | 'bass' | 'alto' | 'tenor';

export interface KeySpec {
  tonic: Letter;
  /** -1 flat, 0 natural, 1 sharp */
  accidental: number;
  mode: Mode;
}

export interface SpelledNote {
  letter: Letter;
  /** -2..2: double flat .. double sharp */
  accidental: number;
  /** Scientific octave of the letter (C4 = middle C). */
  octave: number;
}

export interface AnalyzerSettings {
  key: KeySpec;
  clef: ClefId;
  /** Reference pitch, default 440. */
  a4Hz: number;
}

export interface PitchFrame {
  frequencyHz: number;
  /** Fractional MIDI number (69 = A4 at the configured reference). */
  midi: number;
  /** Note to display; changes only past the hysteresis band. */
  stableMidi: number;
  /** Deviation of `midi` from `stableMidi` in cents. Per frame: follows the vibrato. */
  cents: number;
  /**
   * Vibrato center: fractional MIDI number averaged over about 300 ms of the
   * current note (restarts on a new stable note and after a pause).
   */
  centerMidi: number;
  /** Deviation of `centerMidi` from `stableMidi` in cents. Judge accuracy by this. */
  centerCents: number;
  /**
   * False right after an onset or a note change while the center is too young
   * to judge (with vibrato it would still follow the swing): show no zone then.
   * Stays true until the note changes.
   */
  centerReady: boolean;
  clarity: number;
  rms: number;
  /** `stableMidi` spelled in the configured key. */
  note: SpelledNote;
  /** Scale degree 1..7, or null when the note is out of key. */
  degree: number | null;
  inKey: boolean;
  /** Staff position for the configured clef: 0 = bottom line, 8 = top line. */
  staffStep: number;
}

export interface Analyzer {
  /** Samples per `process` call. */
  readonly frameSize: number;
  /** Recommended number of new samples between consecutive frames. */
  readonly hopSize: number;
  configure(settings: AnalyzerSettings): void;
  /** `frame.length` must equal `frameSize`. Returns null while silent/unpitched. */
  process(frame: Float32Array): PitchFrame | null;
  /**
   * Tell the analyzer which drone the app is playing (`null`, 0 or a
   * non-finite value: none). With `filter`, frames that look like the drone
   * leaking from the speakers into the microphone are treated as unpitched
   * (`process` returns null); either way `droneLeak` reports them. Keeps all
   * other state, so call it on every drone, pitch or A4 change.
   */
  setDrone(hz: number | null, filter: boolean): void;
  /** True when the last `process` call heard the drone leaking into the microphone. */
  readonly droneLeak: boolean;
  /**
   * Background noise floor (linear RMS) measured while listening, or null
   * while it is still being measured. Updated by every `process` call,
   * pitched or not.
   */
  readonly noiseFloor: number | null;
  /**
   * RMS gate (linear) the next frame must reach to be analyzed: set
   * automatically a margin above `noiseFloor`, within fixed bounds, and a
   * default until the floor is known. Updated by every `process` call.
   */
  readonly gate: number;
  /** All 30 supported keys (15 major, 15 minor). */
  keys(): KeySpec[];
  /** Sharps (positive) or flats (negative) in the key signature. */
  signature(key: KeySpec): number;
  /** Spell an arbitrary MIDI note in the configured key (for target notes, drone label, etc.). */
  spell(midi: number): SpelledNote;
  dispose(): void;
}

export type AnalyzerFactory = (sampleRate: number) => Promise<Analyzer>;

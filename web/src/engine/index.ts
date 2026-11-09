// Real engine: the Rust core compiled to WebAssembly (see `wasm/` and
// `scripts/build-wasm.sh`). Falls back to the pure-TS mock when the WASM
// package has not been built (unit tests, plain `pnpm build` without Rust).

import { createMockAnalyzer } from './mock';
import type {
  Analyzer,
  AnalyzerFactory,
  ClefId,
  KeySpec,
  Letter,
  PitchFrame,
  SpelledNote,
} from './types';

export type * from './types';

const FRAME_SIZE = 2048;
const HOP_SIZE = 512;

const LETTERS: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const CLEFS: readonly ClefId[] = ['treble', 'treble8vb', 'bass', 'alto', 'tenor'];

interface WasmAnalyzer {
  readonly frameSize: number;
  readonly hopSize: number;
  configure(tonic: number, accidental: number, mode: number, clef: number, a4Hz: number): boolean;
  process(frame: Float32Array, out: Float64Array): boolean;
  spell(midi: number): Int32Array;
  setDrone(hz: number, filter: boolean): void;
  readonly droneLeak: boolean;
  readonly noiseFloor: number;
  readonly gate: number;
  reset(): void;
  free(): void;
}

export interface WasmModule {
  default: () => Promise<unknown>;
  Analyzer: new (sampleRate: number, frameSize: number, hopSize: number) => WasmAnalyzer;
  allKeys: () => Int8Array;
  keySignature: (tonic: number, accidental: number, mode: number) => number;
  frameFields: () => number;
}

// `import.meta.glob` resolves to an empty object when the package is missing,
// so builds and tests work without the Rust toolchain.
const wasmModules = import.meta.glob<WasmModule>('../wasm-pkg/ktone_wasm.js');

let modulePromise: Promise<WasmModule | null> | null = null;

function loadWasm(): Promise<WasmModule | null> {
  // Unit tests use the mock; the adapter itself is covered by wasm.test.ts.
  if (import.meta.env.MODE === 'test') return Promise.resolve(null);
  if (!modulePromise) {
    const loader = Object.values(wasmModules)[0];
    modulePromise = loader
      ? loader().then(async (mod) => {
          await mod.default();
          return mod;
        })
      : Promise.resolve(null);
  }
  return modulePromise;
}

const letterIndex = (letter: Letter): number => LETTERS.indexOf(letter);
const modeIndex = (key: KeySpec): number => (key.mode === 'minor' ? 1 : 0);

function toNote(letter: number, accidental: number, octave: number): SpelledNote {
  return { letter: LETTERS[letter] ?? 'C', accidental, octave };
}

/** Wraps an initialized WASM module as an `Analyzer`. Exported for tests. */
export function wrapWasm(mod: WasmModule, sampleRate: number): Analyzer {
  const inner = new mod.Analyzer(sampleRate, FRAME_SIZE, HOP_SIZE);
  const out = new Float64Array(mod.frameFields());
  const keys: KeySpec[] = [];
  const flat = mod.allKeys();
  for (let i = 0; i + 2 < flat.length; i += 3) {
    keys.push({
      tonic: LETTERS[flat[i]] ?? 'C',
      accidental: flat[i + 1],
      mode: flat[i + 2] === 1 ? 'minor' : 'major',
    });
  }

  return {
    frameSize: inner.frameSize,
    hopSize: inner.hopSize,
    configure({ key, clef, a4Hz }) {
      inner.configure(
        letterIndex(key.tonic),
        key.accidental,
        modeIndex(key),
        Math.max(0, CLEFS.indexOf(clef)),
        a4Hz,
      );
    },
    process(frame): PitchFrame | null {
      if (!inner.process(frame, out)) return null;
      const degree = out[9];
      return {
        frequencyHz: out[0],
        midi: out[1],
        stableMidi: out[2],
        cents: out[3],
        clarity: out[4],
        rms: out[5],
        note: toNote(out[6], out[7], out[8]),
        degree: degree > 0 ? degree : null,
        inKey: out[10] === 1,
        staffStep: out[11],
        centerMidi: out[12],
        centerCents: out[13],
        centerReady: out[14] === 1,
      };
    },
    setDrone(hz, filter) {
      inner.setDrone(hz ?? 0, filter);
    },
    get droneLeak() {
      return inner.droneLeak;
    },
    get noiseFloor() {
      const floor = inner.noiseFloor;
      return floor > 0 ? floor : null;
    },
    get gate() {
      return inner.gate;
    },
    keys: () => keys.map((k) => ({ ...k })),
    signature: (key) => mod.keySignature(letterIndex(key.tonic), key.accidental, modeIndex(key)),
    spell(midi) {
      const [letter, accidental, octave] = inner.spell(Math.round(midi));
      return toNote(letter, accidental, octave);
    },
    dispose: () => inner.free(),
  };
}

/** Creates the WASM analyzer, or the TS mock if the WASM package is unavailable. */
export const createAnalyzer: AnalyzerFactory = async (sampleRate) => {
  try {
    const mod = await loadWasm();
    if (mod) return wrapWasm(mod, sampleRate);
  } catch (error) {
    console.warn('kTone: WASM engine failed to load, using the TS fallback', error);
  }
  return createMockAnalyzer(sampleRate);
};

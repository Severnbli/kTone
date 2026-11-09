// The TS mock (the fallback when WASM fails to load) must show the same notes
// as the Rust core. Both engines get the same synthetic signals (the cases of
// core/tests/pitch_switching.rs and a few of pitch_drone.rs) and must agree on
// the displayed note wherever the core's own tests pin it down. Skipped when
// the WASM package has not been built (`pnpm wasm`); CI builds it first.
import { describe, expect, it } from 'vitest';
import { createMockAnalyzer } from './mock';
import type { Analyzer } from './types';
import { feedNoise } from '../test/noise';
import { hasWasm, loadWasmAnalyzer } from '../test/wasm';

const SR = 48_000;
const VOICE = [1, 0.6, 0.3, 0.15];
const midiToHz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Voice-like tone with pitch `pitch(t)` in MIDI (as `synth` in pitch_switching.rs). */
function synth(seconds: number, pitch: (t: number) => number, amp = 0.3): Float32Array {
  const norm = VOICE.reduce((s, a) => s + a, 0);
  const out = new Float32Array(Math.floor(seconds * SR));
  let phase = 0.4;
  for (let i = 0; i < out.length; i++) {
    const f = midiToHz(pitch(i / SR));
    let s = 0;
    VOICE.forEach((a, k) => {
      if (f * (k + 1) < SR / 2) s += a * Math.sin((k + 1) * phase);
    });
    phase = (phase + (2 * Math.PI * f) / SR) % (2 * Math.PI * 64);
    out[i] = (amp * s) / norm;
  }
  return out;
}

interface Out {
  /** Time of the frame end in seconds. */
  t: number;
  note: number | null;
  midi: number | null;
}

/** Feeds `signal` hop by hop; returns what each frame shows. */
function track(a: Analyzer, signal: Float32Array, a4At?: (t: number) => number): Out[] {
  const out: Out[] = [];
  for (let start = 0; start + a.frameSize <= signal.length; start += a.hopSize) {
    const t = (start + a.frameSize) / SR;
    if (a4At) a.configure({ ...SETTINGS, a4Hz: a4At(t) });
    const f = a.process(signal.subarray(start, start + a.frameSize));
    out.push({ t, note: f?.stableMidi ?? null, midi: f?.midi ?? null });
  }
  return out;
}

const SETTINGS = {
  key: { tonic: 'C', accidental: 0, mode: 'major' },
  clef: 'treble',
  a4Hz: 440,
} as const;

const notes = (out: Out[], from: number, to: number) =>
  out.filter((o) => o.t >= from && o.t <= to && o.note !== null).map((o) => o.note);

async function engines(): Promise<[string, Analyzer][]> {
  const mock = await createMockAnalyzer(SR);
  const wasm = await loadWasmAnalyzer(SR);
  for (const a of [mock, wasm]) a.configure({ ...SETTINGS, key: { ...SETTINGS.key } });
  return [
    ['mock', mock],
    ['wasm', wasm],
  ];
}

/** Runs `signal` through both engines. */
async function both(signal: Float32Array): Promise<Record<'mock' | 'wasm', Out[]>> {
  const [[, mock], [, wasm]] = await engines();
  const result = { mock: track(mock, signal), wasm: track(wasm, signal) };
  mock.dispose();
  wasm.dispose();
  return result;
}

describe.skipIf(!hasWasm)('mock vs WASM engine: the same displayed notes', () => {
  it.each([
    [60, 0.9, 4.5],
    [60, 0.75, 6.5],
    [59.75, 0.6, 5.5],
    [64.25, 0.6, 4.5],
  ])('a wide vibrato (%f ±%f at %f Hz) never switches the note', async (center, depth, rate) => {
    const signal = synth(2, (t) => center + depth * Math.sin(2 * Math.PI * rate * t));
    const out = await both(signal);
    for (const engine of ['mock', 'wasm'] as const) {
      const shown = notes(out[engine], 0.3, 2);
      expect(shown.length, engine).toBeGreaterThan(150);
      expect(new Set(shown), engine).toEqual(new Set([Math.round(center)]));
    }
  });

  it('a steady pitch past the midpoint is shown as the neighbor after 0.1–0.4 s', async () => {
    const out = await both(synth(2, (t) => (t < 0.8 ? 60 : 60.65)));
    const switched: number[] = [];
    for (const engine of ['mock', 'wasm'] as const) {
      expect(new Set(notes(out[engine], 0.3, 0.9)), engine).toEqual(new Set([60]));
      expect(new Set(notes(out[engine], 1.3, 2)), engine).toEqual(new Set([61]));
      const first = out[engine].find((o) => o.note === 61)!.t - 0.8;
      expect(first, engine).toBeGreaterThanOrEqual(0.1);
      expect(first, engine).toBeLessThanOrEqual(0.4);
      switched.push(first);
    }
    // Both move with the center: within two hops of each other.
    expect(Math.abs(switched[0] - switched[1])).toBeLessThanOrEqual((2 * 512) / SR + 1e-9);
  });

  it('a note reached through a passing one (a glide into a flat A3) is shown promptly', async () => {
    const out = await both(
      synth(1.6, (t) => 55 + 1.65 * Math.min(1, Math.max(0, (t - 0.8) / 0.12))),
    );
    for (const engine of ['mock', 'wasm'] as const) {
      expect(new Set(notes(out[engine], 1.01, 1.6)), engine).toEqual(new Set([57]));
    }
  });

  it('a semitone step after a vibrato (through its troughs) is followed', async () => {
    const out = await both(
      synth(2, (t) => (t < 1 ? 62 : 63) + 0.4 * Math.sin(2 * Math.PI * 5.5 * t)),
    );
    for (const engine of ['mock', 'wasm'] as const) {
      expect(new Set(notes(out[engine], 0.3, 1)), engine).toEqual(new Set([62]));
      expect(new Set(notes(out[engine], 1.15, 2)), engine).toEqual(new Set([63]));
    }
  });

  it.each([
    [57, 58],
    [64, 63],
    [60, 64],
    [64, 57],
  ])('a straight step %i -> %i is followed at once', async (from, to) => {
    const out = await both(synth(1.6, (t) => (t < 0.8 ? from : to)));
    for (const engine of ['mock', 'wasm'] as const) {
      const frames = out[engine];
      const past = frames.findIndex((o) => o.midi !== null && Math.abs(o.midi - from) > 0.8);
      expect(past, engine).toBeGreaterThan(0);
      expect(frames[past].note, engine).toBe(to);
      expect(new Set(notes(frames.slice(past), 0, 1.6)), engine).toEqual(new Set([to]));
      expect(new Set(notes(frames, 0.2, 0.8)), engine).toEqual(new Set([from]));
    }
  });

  it('a straight tone shows the same note on every frame in both engines', async () => {
    const out = await both(synth(1, () => 57.2));
    expect(out.mock.map((o) => o.note)).toEqual(out.wasm.map((o) => o.note));
  });

  it('an A4 change keeps the noise floor, and a quiet 440 Hz reads about -8 cents', async () => {
    for (const [engine, a] of await engines()) {
      feedNoise(a, -70, 1);
      const floor = a.noiseFloor;
      const gate = a.gate;
      expect(floor, engine).not.toBeNull();
      a.configure({ ...SETTINGS, key: { ...SETTINGS.key }, a4Hz: 442 });
      expect(a.noiseFloor, engine).toBe(floor);
      expect(a.gate, engine).toBe(gate);
      // At -52 dBFS, below the default gate (-46 dBFS) but above the measured one.
      const out = track(
        a,
        synth(0.4, () => 69, 0.0035),
      );
      const shown = out.filter((o) => o.note !== null);
      expect(shown.length, engine).toBeGreaterThan(25);
      expect(new Set(shown.map((o) => o.note)), engine).toEqual(new Set([69]));
      const cents = (shown.at(-1)!.midi! - 69) * 100;
      expect(Math.abs(cents + 7.85), engine).toBeLessThan(1.5);
      a.dispose();
    }
  });

  it('input glitches in the leaked drone never show a note', async () => {
    const c3 = midiToHz(48);
    // The drone as the mic hears it from the speakers (see scripts/gen-wav.mjs).
    const clean = Float32Array.from({ length: SR * 2 }, (_, i) => {
      const ph = (2 * Math.PI * c3 * i) / SR;
      return 0.06 * (Math.sin(ph) + 0.2 * Math.sin(2 * ph) - 0.0225 * Math.sin(6 * ph));
    });
    for (const len of [128, 300]) {
      // Lose `len` samples every 0.25 s from 0.3 s on: a starved audio thread.
      const parts: Float32Array[] = [];
      let at = 0;
      for (let k = 0; k < 6; k++) {
        const cut = Math.round(0.3 * SR) + k * 12_097;
        parts.push(clean.subarray(at, cut));
        at = cut + len;
      }
      parts.push(clean.subarray(at));
      const signal = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
      parts.reduce((o, p) => (signal.set(p, o), o + p.length), 0);
      for (const [engine, a] of await engines()) {
        a.setDrone(c3, true);
        const out = track(a, signal);
        expect(
          out.filter((o) => o.note !== null).map((o) => o.t),
          `${engine}, ${len}`,
        ).toEqual([]);
        a.dispose();
      }
    }
  });
});

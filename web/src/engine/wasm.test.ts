// Exercises the real Rust engine through the TS adapter. Skipped when the WASM
// package has not been built (`pnpm wasm`).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wrapWasm, type WasmModule } from './index';
import type { Analyzer, AnalyzerSettings } from './types';

// Vitest runs from web/; jsdom gives modules http URLs, so resolve from cwd.
const pkgDir = `${resolve('src/wasm-pkg')}/`;
const hasWasm = existsSync(`${pkgDir}ktone_wasm_bg.wasm`);

const SR = 48_000;

async function load(): Promise<Analyzer> {
  const mod = (await import(/* @vite-ignore */ `${pkgDir}ktone_wasm.js`)) as WasmModule & {
    initSync: (opts: { module: BufferSource }) => unknown;
  };
  mod.initSync({ module: readFileSync(`${pkgDir}ktone_wasm_bg.wasm`) });
  return wrapWasm(mod, SR);
}

function feedSine(analyzer: Analyzer, freq: number) {
  const frame = new Float32Array(analyzer.frameSize);
  let last = null;
  for (let hop = 0; hop < 20; hop++) {
    for (let i = 0; i < frame.length; i++) {
      const t = (i + hop * analyzer.hopSize) / SR;
      frame[i] = 0.5 * Math.sin(2 * Math.PI * freq * t);
    }
    last = analyzer.process(frame) ?? last;
  }
  return last;
}

const settings = (overrides: Partial<AnalyzerSettings> = {}): AnalyzerSettings => ({
  key: { tonic: 'C', accidental: 0, mode: 'major' },
  clef: 'treble',
  a4Hz: 440,
  ...overrides,
});

describe.skipIf(!hasWasm)('WASM engine adapter', () => {
  it('detects A4 and maps every field', async () => {
    const a = await load();
    a.configure(settings());
    const f = feedSine(a, 440);
    expect(f).not.toBeNull();
    expect(f!.frequencyHz).toBeCloseTo(440, 0);
    expect(f!.stableMidi).toBe(69);
    expect(Math.abs(f!.cents)).toBeLessThan(3);
    expect(f!.note).toEqual({ letter: 'A', accidental: 0, octave: 4 });
    expect(f!.degree).toBe(6);
    expect(f!.inKey).toBe(true);
    expect(f!.staffStep).toBe(3);
    expect(f!.centerMidi).toBeCloseTo(69, 1);
    expect(Math.abs(f!.centerCents)).toBeLessThan(3);
    a.dispose();
  });

  it('spells by key and marks out-of-key notes', async () => {
    const a = await load();
    a.configure(settings({ key: { tonic: 'D', accidental: 0, mode: 'major' } }));
    const f = feedSine(a, 466.16); // A sharp / B flat
    expect(f!.note).toEqual({ letter: 'A', accidental: 1, octave: 4 });
    expect(f!.inKey).toBe(false);
    expect(f!.degree).toBeNull();
    a.configure(settings({ key: { tonic: 'F', accidental: 0, mode: 'major' } }));
    expect(a.spell(70)).toEqual({ letter: 'B', accidental: -1, octave: 4 });
    a.dispose();
  });

  it('passes the drone through and reports leaks', async () => {
    const a = await load();
    a.configure(settings());
    a.setDrone(440, true);
    expect(feedSine(a, 440)).toBeNull();
    expect(a.droneLeak).toBe(true);
    a.setDrone(440, false);
    expect(feedSine(a, 440)?.stableMidi).toBe(69);
    expect(a.droneLeak).toBe(true);
    a.setDrone(null, true);
    expect(feedSine(a, 440)?.stableMidi).toBe(69);
    expect(a.droneLeak).toBe(false);
    a.dispose();
  });

  it('returns null for silence and lists 30 keys with signatures', async () => {
    const a = await load();
    expect(a.process(new Float32Array(a.frameSize))).toBeNull();
    expect(a.keys()).toHaveLength(30);
    expect(a.signature({ tonic: 'D', accidental: -1, mode: 'major' })).toBe(-5);
    a.dispose();
  });
});

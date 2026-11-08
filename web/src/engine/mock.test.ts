import { describe, expect, it } from 'vitest';
import type { KeySpec } from './types';
import { createMockAnalyzer, detectPitch, spellInKey } from './mock';
import { createAnalyzer } from './index';

const SR = 48000;
const key = (tonic: KeySpec['tonic'], accidental: number, mode: KeySpec['mode']): KeySpec => ({
  tonic,
  accidental,
  mode,
});

function sine(hz: number, n = 2048, amp = 0.5, sr = SR): Float32Array {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / sr));
}

function voiceLike(hz: number, n = 2048): Float32Array {
  // Fundamental plus decaying harmonics.
  return Float32Array.from({ length: n }, (_, i) => {
    let v = 0;
    for (let h = 1; h <= 5; h++) v += (0.4 / h) * Math.sin((2 * Math.PI * hz * h * i) / SR);
    return v;
  });
}

describe('mock analyzer', () => {
  it('exposes frame and hop sizes', async () => {
    const a = await createMockAnalyzer(SR);
    expect(a.frameSize).toBe(2048);
    expect(a.hopSize).toBe(512);
  });

  it('the placeholder factory delegates to the mock', async () => {
    const a = await createAnalyzer(SR);
    expect(a.keys()).toHaveLength(30);
  });

  it('detects A4 = 440 Hz', async () => {
    const a = await createMockAnalyzer(SR);
    a.configure({ key: key('C', 0, 'major'), clef: 'treble', a4Hz: 440 });
    const f = a.process(sine(440))!;
    expect(f).not.toBeNull();
    expect(f.frequencyHz).toBeCloseTo(440, 0);
    expect(f.stableMidi).toBe(69);
    expect(Math.abs(f.cents)).toBeLessThan(3);
    expect(f.note).toEqual({ letter: 'A', accidental: 0, octave: 4 });
    expect(f.degree).toBe(6);
    expect(f.inKey).toBe(true);
    expect(f.staffStep).toBe(3);
    expect(f.clarity).toBeGreaterThan(0.8);
  });

  it.each([82.41, 110, 196, 261.63, 523.25, 1046.5])('detects %f Hz (voice range)', async (hz) => {
    const a = await createMockAnalyzer(SR);
    const f = a.process(voiceLike(hz))!;
    expect(f).not.toBeNull();
    expect(Math.abs(f.frequencyHz / hz - 1)).toBeLessThan(0.005);
  });

  it('respects the A4 reference', async () => {
    const a = await createMockAnalyzer(SR);
    a.configure({ key: key('C', 0, 'major'), clef: 'treble', a4Hz: 442 });
    const f = a.process(sine(442))!;
    expect(f.stableMidi).toBe(69);
    expect(Math.abs(f.cents)).toBeLessThan(3);
  });

  it('reports cents deviation', async () => {
    const a = await createMockAnalyzer(SR);
    const f = a.process(sine(440 * Math.pow(2, 20 / 1200)))!;
    expect(f.stableMidi).toBe(69);
    expect(f.cents).toBeGreaterThan(17);
    expect(f.cents).toBeLessThan(23);
  });

  it('applies hysteresis between neighboring notes', async () => {
    const a = await createMockAnalyzer(SR);
    a.process(sine(440));
    // +55 cents: past the half-semitone line but inside the hysteresis band.
    const f = a.process(sine(440 * Math.pow(2, 55 / 1200)))!;
    expect(f.stableMidi).toBe(69);
    const g = a.process(sine(440 * Math.pow(2, 75 / 1200)))!;
    expect(g.stableMidi).toBe(70);
  });

  it('returns null for silence and noise', async () => {
    const a = await createMockAnalyzer(SR);
    expect(a.process(new Float32Array(2048))).toBeNull();
    let seed = 1;
    const noise = Float32Array.from({ length: 2048 }, () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed / 0x7fffffff - 0.5) * 0.8;
    });
    expect(a.process(noise)).toBeNull();
  });

  it('rejects wrong frame sizes', async () => {
    const a = await createMockAnalyzer(SR);
    expect(() => a.process(new Float32Array(100))).toThrow();
  });

  it('lists 30 keys and their signatures', async () => {
    const a = await createMockAnalyzer(SR);
    const keys = a.keys();
    expect(keys.filter((k) => k.mode === 'major')).toHaveLength(15);
    expect(a.signature(key('D', 0, 'major'))).toBe(2);
    expect(a.signature(key('E', -1, 'minor'))).toBe(-6);
  });

  it('spells by key: F♯ in D major, G♭ in D♭ major', async () => {
    const a = await createMockAnalyzer(SR);
    a.configure({ key: key('D', 0, 'major'), clef: 'treble', a4Hz: 440 });
    expect(a.spell(66)).toEqual({ letter: 'F', accidental: 1, octave: 4 });
    a.configure({ key: key('D', -1, 'major'), clef: 'treble', a4Hz: 440 });
    expect(a.spell(66)).toEqual({ letter: 'G', accidental: -1, octave: 4 });
  });

  it('chromatic notes: sharps in sharp keys, flats in flat keys', () => {
    expect(spellInKey(70, key('D', 0, 'major'))).toMatchObject({ letter: 'A', accidental: 1 });
    expect(spellInKey(70, key('C', 0, 'major'))).toMatchObject({ letter: 'A', accidental: 1 });
    expect(spellInKey(66, key('F', 0, 'major'))).toMatchObject({ letter: 'G', accidental: -1 });
  });

  it('diatonic enharmonics keep their octave: B♯3 in C♯ major, C♭4 in C♭ major', () => {
    expect(spellInKey(60, key('C', 1, 'major'))).toEqual({ letter: 'B', accidental: 1, octave: 3 });
    expect(spellInKey(59, key('C', -1, 'major'))).toEqual({
      letter: 'C',
      accidental: -1,
      octave: 4,
    });
  });

  it('degree and out-of-key flags, staff step per clef', async () => {
    const a = await createMockAnalyzer(SR);
    a.configure({ key: key('F', 0, 'major'), clef: 'bass', a4Hz: 440 });
    const f = a.process(sine(440 * Math.pow(2, 1 / 12)))!; // B♭4
    expect(f.note).toMatchObject({ letter: 'B', accidental: -1, octave: 4 });
    expect(f.degree).toBe(4);
    expect(f.staffStep).toBe(16);
    a.configure({ key: key('D', 0, 'major'), clef: 'bass', a4Hz: 440 });
    const g = a.process(sine(440 * Math.pow(2, 1 / 12)))!; // A♯4, out of key
    expect(g.note).toMatchObject({ letter: 'A', accidental: 1 });
    expect(g.inKey).toBe(false);
    expect(g.degree).toBeNull();
  });

  it('detectPitch returns null below the threshold', () => {
    expect(detectPitch(new Float32Array(2048).fill(0.3), SR)).toBeNull();
  });
});

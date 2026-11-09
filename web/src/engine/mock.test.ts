import { describe, expect, it } from 'vitest';
import type { Analyzer, KeySpec, PitchFrame } from './types';
import { createMockAnalyzer, detectPitch, spellInKey } from './mock';
import { createAnalyzer } from './index';
import { GATE_MARGIN_DB, GATE_MAX_DBFS, GATE_MIN_DBFS } from './noiseFloor';
import { feedNoise } from '../test/noise';

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
  it('measures the noise floor and sets the gate above it', async () => {
    const a = await createMockAnalyzer(SR);
    expect(a.noiseFloor).toBeNull();
    expect(20 * Math.log10(a.gate)).toBeCloseTo(-46.02, 1);
    // Quiet room: the gate drops to its minimum, −60 dBFS.
    const quiet = feedNoise(a, -75);
    expect(quiet.pitched).toBe(0);
    expect(quiet.floorDb).toBeGreaterThan(-78);
    expect(quiet.floorDb).toBeLessThan(-74);
    expect(quiet.gateDb).toBeCloseTo(GATE_MIN_DBFS, 3);
    // Moderate noise: the floor plus 11 dB.
    const room = feedNoise(a, -55, 2);
    expect(room.pitched).toBe(0);
    expect(room.gateDb - room.floorDb!).toBeCloseTo(GATE_MARGIN_DB, 3);
    // Noisy room: pinned at the maximum, −34 dBFS.
    const noisy = feedNoise(a, -40, 2);
    expect(noisy.pitched).toBe(0);
    expect(noisy.gateDb).toBeCloseTo(GATE_MAX_DBFS, 3);
    a.dispose();
  });

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

  describe('vibrato center', () => {
    /** Continuous signal with pitch `midi(t)`, analyzed hop by hop. */
    function run(a: Analyzer, seconds: number, midi: (t: number) => number) {
      const n = Math.floor(seconds * SR);
      const signal = new Float32Array(n);
      let phase = 0;
      for (let i = 0; i < n; i++) {
        signal[i] = 0.4 * Math.sin(phase);
        phase += (2 * Math.PI * 440 * Math.pow(2, (midi(i / SR) - 69) / 12)) / SR;
      }
      const out: { t: number; f: PitchFrame | null }[] = [];
      for (let start = 0; start + a.frameSize <= n; start += a.hopSize) {
        const f = a.process(signal.subarray(start, start + a.frameSize));
        out.push({ t: (start + a.frameSize) / SR, f });
      }
      return out;
    }
    const vibrato = (center: number) => (t: number) =>
      center + 0.4 * Math.sin(2 * Math.PI * 5.5 * t);

    it('stays near the center of a ±40 cent vibrato while raw cents swing', async () => {
      const a = await createMockAnalyzer(SR);
      const frames = run(a, 1.5, vibrato(69))
        .filter(({ t }) => t > 0.5)
        .map(({ f }) => f!);
      expect(frames.every((f) => f.stableMidi === 69)).toBe(true);
      expect(Math.max(...frames.map((f) => Math.abs(f.centerCents)))).toBeLessThan(6);
      expect(Math.max(...frames.map((f) => f.cents))).toBeGreaterThan(30);
      expect(Math.min(...frames.map((f) => f.cents))).toBeLessThan(-30);
      for (const f of frames) {
        expect(f.centerCents).toBeCloseTo((f.centerMidi - f.stableMidi) * 100, 3);
      }
    });

    it('reports an off-center vibrato', async () => {
      const a = await createMockAnalyzer(SR);
      const frames = run(a, 1.5, vibrato(69.2)).filter(({ t }) => t > 0.5);
      for (const { f } of frames) expect(Math.abs(f!.centerCents - 20)).toBeLessThan(6);
    });

    it('restarts on a new note so a leap is not dragged', async () => {
      const a = await createMockAnalyzer(SR);
      const frames = run(a, 1.5, (t) => (t < 1 ? 60 : 64)).filter(({ t }) => t > 1.1);
      for (const { f } of frames) {
        expect(f!.stableMidi).toBe(64);
        expect(Math.abs(f!.centerCents)).toBeLessThan(3);
      }
    });

    it('reports the center ready at once for a straight tone, later for a vibrato', async () => {
      const a = await createMockAnalyzer(SR);
      const straight = run(a, 0.5, () => 64);
      const firstReady = straight.findIndex(({ f }) => f?.centerReady);
      expect(straight[0].f!.centerReady).toBe(false);
      expect(firstReady).toBeGreaterThan(0);
      expect(firstReady).toBeLessThanOrEqual(6);
      expect(straight.slice(firstReady).every(({ f }) => f!.centerReady)).toBe(true);

      const b = await createMockAnalyzer(SR);
      const swinging = run(b, 0.6, vibrato(64));
      const t = swinging.find(({ f }) => f?.centerReady)!.t - swinging[0].t;
      expect(t).toBeGreaterThan(0.12);
      expect(t).toBeLessThan(0.22);
    });

    it('restarts after a pause but not after a single dropout', async () => {
      const a = await createMockAnalyzer(SR);
      const silence = new Float32Array(a.frameSize);
      run(a, 0.5, () => 69);
      a.process(silence);
      const kept = run(a, 0.06, () => 69.3).at(-1)!.f!;
      expect(kept.centerCents).toBeLessThan(25);
      for (let i = 0; i < 4; i++) a.process(silence);
      const fresh = run(a, 0.06, () => 69.3).at(-1)!.f!;
      expect(fresh.stableMidi).toBe(69);
      expect(Math.abs(fresh.centerCents - 30)).toBeLessThan(3);
    });
  });

  describe('drone filter', () => {
    const D3 = 146.83;
    /** Drone-like frame: a sine plus a weak octave (like `drone.ts`), at sample offset `at`. */
    const droneFrame = (hz: number, at = 0) =>
      Float32Array.from({ length: 2048 }, (_, i) => {
        const ph = (2 * Math.PI * hz * (i + at)) / SR;
        return 0.1 * Math.sin(ph) + 0.02 * Math.sin(2 * ph);
      });
    const voiceFrame = (hz: number, at = 0) => {
      const drone = droneFrame(D3, at);
      return Float32Array.from({ length: 2048 }, (_, i) => {
        let v = 0;
        for (let h = 1; h <= 6; h++) {
          v += (0.1 / h) * Math.sin((2 * Math.PI * hz * h * (i + at)) / SR);
        }
        return v + 0.3 * drone[i];
      });
    };
    const runFrames = (a: Analyzer, make: (at: number) => Float32Array, count = 12) =>
      Array.from({ length: count }, (_, k) => {
        const f = a.process(make(k * 512));
        return { f, leak: a.droneLeak };
      });

    it('ignores the drone and flags it', async () => {
      const a = await createMockAnalyzer(SR);
      expect(runFrames(a, (at) => droneFrame(D3, at)).every(({ f }) => f !== null)).toBe(true);
      a.setDrone(D3, true);
      const out = runFrames(a, (at) => droneFrame(D3, at));
      expect(out.every(({ f, leak }) => f === null && leak)).toBe(true);
    });

    it('still shows the drone with the filter off, but flags it', async () => {
      const a = await createMockAnalyzer(SR);
      a.setDrone(D3, false);
      const out = runFrames(a, (at) => droneFrame(D3, at));
      expect(out.every(({ f, leak }) => f?.stableMidi === 50 && leak)).toBe(true);
    });

    it('hears a voice on the drone pitch, an octave above, and on another note', async () => {
      const a = await createMockAnalyzer(SR);
      a.setDrone(D3, true);
      for (const midi of [50, 62, 55]) {
        const hz = 440 * 2 ** ((midi - 69) / 12);
        const out = runFrames(a, (at) => voiceFrame(hz, at));
        expect([midi, out.map(({ f }) => f?.stableMidi)]).toEqual([midi, Array(12).fill(midi)]);
        expect(out.some(({ leak }) => leak)).toBe(false);
      }
    });

    it('ignores the drone fading in and out', async () => {
      const a = await createMockAnalyzer(SR);
      a.setDrone(D3, true);
      // Linear attack over 0.4 s from silence, like `drone.ts`, then a release.
      const gain = (i: number) => Math.min(1, i / (0.4 * SR), Math.max(0, (SR - i) / (0.3 * SR)));
      const out = runFrames(
        a,
        (at) => {
          const f = droneFrame(D3, at);
          return f.map((v, i) => v * gain(at + i) + 1e-4 * Math.sin(i * 7.1));
        },
        90,
      );
      expect(out.filter(({ f }) => f !== null)).toEqual([]);
    });

    it('ignores a drone heard once the stream starts mid-frame', async () => {
      const a = await createMockAnalyzer(SR);
      a.setDrone(D3, true);
      // The first blocks of a microphone stream are exact zeros.
      const out = runFrames(a, (at) => droneFrame(D3, at).map((v, i) => (at + i < 2600 ? 0 : v)));
      expect(out.filter(({ f }) => f !== null)).toEqual([]);
      expect(out.at(-1)?.leak).toBe(true);
    });

    it('treats null, zero and NaN as no drone', async () => {
      const a = await createMockAnalyzer(SR);
      for (const off of [null, 0, NaN]) {
        a.setDrone(D3, true);
        a.setDrone(off, true);
        const out = runFrames(a, (at) => droneFrame(D3, at), 3);
        expect(out.every(({ f, leak }) => f?.stableMidi === 50 && !leak)).toBe(true);
      }
    });
  });

  it('detectPitch returns null below the threshold', () => {
    expect(detectPitch(new Float32Array(2048).fill(0.3), SR)).toBeNull();
  });
});

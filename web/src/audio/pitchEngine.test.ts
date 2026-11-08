import { describe, expect, it, vi } from 'vitest';
import { createMockAnalyzer } from '../engine/mock';
import type { Analyzer, AnalyzerSettings } from '../engine/types';
import { MicError, classifyMicError } from './mic';
import { PitchEngine } from './pitchEngine';
import { PitchStore } from './pitchStore';

const SR = 48000;
const settings: AnalyzerSettings = {
  key: { tonic: 'C', accidental: 0, mode: 'major' },
  clef: 'treble',
  a4Hz: 440,
};

function fakeMic() {
  let onBlock: ((b: Float32Array) => void) | null = null;
  const stop = vi.fn(async () => undefined);
  const startMic = vi.fn(async (cb: (b: Float32Array) => void) => {
    onBlock = cb;
    return { sampleRate: SR, stop };
  });
  let phase = 0;
  const feedSine = (hz: number, samples: number) => {
    for (let done = 0; done < samples; done += 128) {
      const block = new Float32Array(128);
      for (let i = 0; i < 128; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * hz * phase++) / SR);
      onBlock?.(block);
    }
  };
  return { startMic, stop, feedSine };
}

describe('PitchEngine', () => {
  it('runs the analyzer every hop and fills the store', async () => {
    const mic = fakeMic();
    const store = new PitchStore();
    let t = 0;
    const engine = new PitchEngine(store, {
      factory: createMockAnalyzer,
      startMic: mic.startMic,
      now: () => (t += 10),
    });
    await engine.start(settings);
    expect(engine.running).toBe(true);
    mic.feedSine(440, 2048 + 512 * 3);
    expect(store.history.size).toBe(4);
    expect(store.getNote()?.note).toEqual({ letter: 'A', accidental: 0, octave: 4 });

    engine.configure({ ...settings, key: { tonic: 'D', accidental: 0, mode: 'major' } });
    mic.feedSine(440 * Math.pow(2, 1 / 12), 2048);
    expect(store.getNote()?.note).toMatchObject({ letter: 'A', accidental: 1 });

    await engine.stop();
    expect(mic.stop).toHaveBeenCalled();
    expect(engine.running).toBe(false);
    expect(store.getNote()).toBeNull();
  });

  it('passes the drone to the analyzer and its leak flag to the store', async () => {
    const mic = fakeMic();
    const store = new PitchStore();
    const push = vi.spyOn(store, 'push');
    let analyzer: Analyzer | null = null;
    let t = 0;
    const engine = new PitchEngine(store, {
      factory: async (sr) => (analyzer = await createMockAnalyzer(sr)),
      startMic: mic.startMic,
      now: () => (t += 10),
    });
    // Set before start: applied when the analyzer is created.
    engine.setDrone(440, true);
    await engine.start(settings);
    const setDrone = vi.spyOn(analyzer!, 'setDrone');
    mic.feedSine(440, 2048 + 512);
    expect(push).toHaveBeenLastCalledWith(null, expect.any(Number), true);
    expect(store.getNote()).toBeNull();

    engine.setDrone(440, false);
    expect(setDrone).toHaveBeenLastCalledWith(440, false);
    mic.feedSine(440, 512);
    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({ stableMidi: 69 }),
      expect.any(Number),
      true,
    );

    engine.setDrone(null, true);
    mic.feedSine(440, 512);
    expect(push).toHaveBeenLastCalledWith(
      expect.objectContaining({ stableMidi: 69 }),
      expect.any(Number),
      false,
    );
    await engine.stop();
  });

  it('propagates mic errors and stays stopped', async () => {
    const store = new PitchStore();
    const engine = new PitchEngine(store, {
      factory: createMockAnalyzer,
      startMic: async () => {
        throw new MicError('denied');
      },
      now: () => 0,
    });
    await expect(engine.start(settings)).rejects.toMatchObject({ code: 'denied' });
    expect(engine.running).toBe(false);
  });

  it('stops the mic when the analyzer fails to load', async () => {
    const mic = fakeMic();
    const engine = new PitchEngine(new PitchStore(), {
      factory: async () => {
        throw new Error('wasm');
      },
      startMic: mic.startMic,
      now: () => 0,
    });
    await expect(engine.start(settings)).rejects.toThrow('wasm');
    expect(mic.stop).toHaveBeenCalled();
    expect(engine.running).toBe(false);
  });
});

describe('classifyMicError', () => {
  it('maps DOMException names', () => {
    expect(classifyMicError(new DOMException('x', 'NotAllowedError'))).toBe('denied');
    expect(classifyMicError(new DOMException('x', 'NotFoundError'))).toBe('notFound');
    expect(classifyMicError(new Error('boom'))).toBe('error');
    expect(classifyMicError(undefined)).toBe('error');
  });
});

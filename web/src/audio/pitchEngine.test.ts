import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockAnalyzer } from '../engine/mock';
import type { AnalyzerSettings } from '../engine/types';
import { fakeMic, fakeVisibility, flush } from '../test/fakes';
import { MicError, classifyMicError } from './mic';
import { PitchEngine, type EngineState } from './pitchEngine';
import { PitchStore } from './pitchStore';

const settings: AnalyzerSettings = {
  key: { tonic: 'C', accidental: 0, mode: 'major' },
  clef: 'treble',
  a4Hz: 440,
};

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

describe('PitchEngine lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(hidden = false) {
    const mic = fakeMic();
    const visibility = fakeVisibility(hidden);
    const store = new PitchStore();
    const engine = new PitchEngine(store, {
      factory: createMockAnalyzer,
      startMic: mic.startMic,
      now: () => 0,
      visibility,
      backgroundStopMs: 1000,
    });
    const states: EngineState[] = [];
    engine.subscribe((s) => states.push(s));
    return { mic, visibility, store, engine, states };
  }

  it('reports running after start and idle/user after stop', async () => {
    const { engine, states, visibility } = setup();
    await engine.start(settings);
    expect(engine.state).toEqual({ status: 'running', stopReason: null });
    expect(visibility.listeners).toBe(1);
    await engine.stop();
    expect(states).toEqual([
      { status: 'running', stopReason: null },
      { status: 'idle', stopReason: 'user' },
    ]);
    expect(visibility.listeners).toBe(0);
  });

  it('stops with reason `ended` when the mic track ends', async () => {
    const { engine, mic, store } = setup();
    await engine.start(settings);
    mic.feedSine(440, 2048);
    expect(store.getNote()).not.toBeNull();
    mic.setState('ended');
    await flush();
    expect(engine.state).toEqual({ status: 'idle', stopReason: 'ended' });
    expect(engine.running).toBe(false);
    expect(mic.stop).toHaveBeenCalled();
    expect(store.getNote()).toBeNull();
  });

  it('auto-resumes a suspended mic while visible', async () => {
    const { engine, mic, states } = setup();
    await engine.start(settings);
    mic.setState('suspended');
    await flush();
    expect(mic.resume).toHaveBeenCalledTimes(1);
    expect(engine.state.status).toBe('running');
    expect(states.map((s) => s.status)).toEqual(['running', 'suspended', 'running']);
  });

  it('stays suspended when auto-resume fails, and resume() restarts the mic', async () => {
    const { engine, mic } = setup();
    await engine.start(settings);
    mic.setResumeWorks(false);
    mic.setState('suspended');
    await flush();
    expect(engine.state.status).toBe('suspended');
    expect(engine.running).toBe(true);

    await engine.resume();
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(mic.startMic).toHaveBeenCalledTimes(2);
    expect(engine.state).toEqual({ status: 'running', stopReason: null });
  });

  it('resume() keeps the session when resuming it works', async () => {
    const { engine, mic } = setup();
    await engine.start(settings);
    mic.setResumeWorks(false);
    mic.setState('suspended');
    await flush();
    mic.setResumeWorks(true);
    await engine.resume();
    expect(mic.startMic).toHaveBeenCalledTimes(1);
    expect(engine.state.status).toBe('running');
  });

  it('waits until visible to resume a mic suspended in the background', async () => {
    const { engine, mic, visibility } = setup();
    await engine.start(settings);
    visibility.set(true);
    mic.setState('suspended');
    await flush();
    expect(mic.resume).not.toHaveBeenCalled();
    expect(engine.state.status).toBe('suspended');
    visibility.set(false);
    await flush();
    expect(mic.resume).toHaveBeenCalledTimes(1);
    expect(engine.state.status).toBe('running');
  });

  it('stops after staying hidden for the background timeout', async () => {
    vi.useFakeTimers();
    const { engine, mic, visibility } = setup();
    await engine.start(settings);
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(999);
    expect(engine.running).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(engine.state).toEqual({ status: 'idle', stopReason: 'background' });
    expect(mic.stop).toHaveBeenCalled();
  });

  it('keeps running when the page comes back before the timeout', async () => {
    vi.useFakeTimers();
    const { engine, visibility } = setup();
    await engine.start(settings);
    visibility.set(true);
    await vi.advanceTimersByTimeAsync(900);
    visibility.set(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(engine.state.status).toBe('running');
  });

  it('ignores state events from a stopped session', async () => {
    const { engine, mic } = setup();
    await engine.start(settings);
    await engine.stop();
    mic.setState('ended');
    await flush();
    expect(engine.state).toEqual({ status: 'idle', stopReason: 'user' });
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

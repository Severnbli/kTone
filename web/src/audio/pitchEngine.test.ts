import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMockAnalyzer } from '../engine/mock';
import type { Analyzer, AnalyzerSettings } from '../engine/types';
import { fakeMic, fakeVisibility, flush } from '../test/fakes';
import { DebugStats } from './debugStats';
import { LevelStore } from './level';
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
    // A few frames: the 3-frame median follows the step on the second.
    mic.feedSine(440 * Math.pow(2, 1 / 12), 2048 + 2 * 512);
    expect(store.getNote()?.note).toMatchObject({ letter: 'A', accidental: 1 });

    await engine.stop();
    expect(mic.stop).toHaveBeenCalled();
    expect(engine.running).toBe(false);
    expect(store.getNote()).toBeNull();
  });

  it('records analysis times and dropped hops for the debug overlay', async () => {
    const mic = fakeMic();
    let t = 0;
    const debug = new DebugStats();
    const engine = new PitchEngine(new PitchStore(), {
      factory: createMockAnalyzer,
      startMic: mic.startMic,
      // Two calls per frame: before and after the analysis, 3 ms apart.
      now: () => (t += 3),
      debug,
    });
    await engine.start(settings);
    mic.feedSine(440, 2048 + 512 * 3);
    let s = debug.snapshot();
    expect(s).toMatchObject({ frames: 4, dropped: 0, frameSize: 2048, hopSize: 512 });
    expect(s.analysisMeanMs).toBe(3);
    expect(s.analysisMaxMs).toBe(3);
    // The fake mic reports no latency, like a browser without the API.
    expect(s.latency).toEqual({ baseLatency: null, outputLatency: null });
    // A late, large block: three hops at once, only the newest is analyzed.
    mic.feed(440, 512 * 3);
    s = debug.snapshot();
    expect(s).toMatchObject({ frames: 5, dropped: 2 });
    await engine.stop();
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

  it('keeps the drone across a mic restart', async () => {
    const mic = fakeMic();
    const analyzers: Analyzer[] = [];
    const engine = new PitchEngine(new PitchStore(), {
      factory: async (sr) => {
        const a = await createMockAnalyzer(sr);
        vi.spyOn(a, 'setDrone');
        analyzers.push(a);
        return a;
      },
      startMic: mic.startMic,
      now: () => 0,
    });
    await engine.start(settings);
    engine.setDrone(220, false);
    // A device change and a failed resume both open a new session and analyzer.
    await engine.setDevice('usb-1');
    mic.setResumeWorks(false);
    mic.setState('suspended');
    await flush();
    await engine.resume();
    expect(analyzers).toHaveLength(3);
    expect(analyzers[1].setDrone).toHaveBeenLastCalledWith(220, false);
    expect(analyzers[2].setDrone).toHaveBeenLastCalledWith(220, false);
    await engine.stop();
  });

  it('measures the input level of every frame, pitched or not', async () => {
    const mic = fakeMic();
    const levels = new LevelStore();
    const onLevel = vi.fn();
    levels.subscribeLevel(onLevel);
    const engine = new PitchEngine(new PitchStore(), {
      factory: createMockAnalyzer,
      startMic: mic.startMic,
      now: () => 0,
      levels,
    });
    await engine.start(settings);
    onLevel.mockClear();
    // fakeMic feeds amplitude-0.5 sines: RMS −9 dBFS.
    mic.feedSine(440, 2048 + 512);
    expect(onLevel).toHaveBeenCalledTimes(2);
    expect(levels.level.rmsDb).toBeCloseTo(-9.03, 1);
    expect(levels.level.peak).toBeCloseTo(0.5, 2);
    // The analyzer's live gate: the default (−46 dBFS) until the floor is known.
    expect(levels.level.gateDb).toBeCloseTo(-46.02, 1);
    expect(levels.level.floorDb).toBeNull();

    // Silence produces no pitch but still updates the level.
    mic.feedSine(0, 2048);
    expect(levels.level.rmsDb).toBe(-Infinity);
    expect(onLevel).toHaveBeenCalledTimes(6);

    mic.feedSine(440, 2048);
    await engine.stop();
    expect(levels.level.rmsDb).toBe(-Infinity);
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

describe('PitchEngine input device', () => {
  function setup() {
    const mic = fakeMic();
    const store = new PitchStore();
    const engine = new PitchEngine(store, {
      factory: createMockAnalyzer,
      startMic: mic.startMic,
      now: () => 0,
      visibility: fakeVisibility(),
    });
    const states: EngineState[] = [];
    engine.subscribe((s) => states.push(s));
    const deviceOf = (call: number) => mic.startMic.mock.calls[call][1]?.deviceId;
    return { mic, store, engine, states, deviceOf };
  }

  it('opens the system default unless a device is set', async () => {
    const { engine, mic, deviceOf } = setup();
    await engine.start(settings);
    expect(deviceOf(0)).toBeUndefined();
    await engine.stop();

    await engine.setDevice('usb-1');
    expect(mic.startMic).toHaveBeenCalledTimes(1);
    await engine.start(settings);
    expect(deviceOf(1)).toBe('usb-1');
  });

  it('restarts the mic session on a device change while running', async () => {
    const { engine, mic, store, states, deviceOf } = setup();
    await engine.start(settings);
    mic.feedSine(440, 2048);
    expect(store.getNote()).not.toBeNull();

    await engine.setDevice('usb-1');
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(mic.startMic).toHaveBeenCalledTimes(2);
    expect(deviceOf(1)).toBe('usb-1');
    expect(store.getNote()).toBeNull();
    expect(engine.state).toEqual({ status: 'running', stopReason: null });
    // No idle flash in between.
    expect(states.map((s) => s.status)).toEqual(['running']);

    // Same device: nothing happens. Back to default: restart without an id.
    await engine.setDevice('usb-1');
    expect(mic.startMic).toHaveBeenCalledTimes(2);
    await engine.setDevice('');
    expect(deviceOf(2)).toBeUndefined();

    mic.feedSine(440, 2048);
    expect(store.getNote()?.note.letter).toBe('A');
  });

  it('goes idle and rethrows when the new device fails to open', async () => {
    const { engine, mic } = setup();
    await engine.start(settings);
    mic.startMic.mockRejectedValueOnce(new MicError('error'));
    await expect(engine.setDevice('broken')).rejects.toMatchObject({ code: 'error' });
    expect(engine.running).toBe(false);
    expect(engine.state).toEqual({ status: 'idle', stopReason: null });
  });

  it('switches to a device chosen while the session was still opening', async () => {
    const { engine, deviceOf, mic } = setup();
    const starting = engine.start(settings);
    const switching = engine.setDevice('usb-1');
    await Promise.all([starting, switching]);
    expect(mic.startMic).toHaveBeenCalledTimes(2);
    expect(deviceOf(1)).toBe('usb-1');
    expect(engine.state.status).toBe('running');
  });
});

describe('PitchEngine low range', () => {
  function setup() {
    const mic = fakeMic();
    const store = new PitchStore();
    const factory = vi.fn(createMockAnalyzer);
    const engine = new PitchEngine(store, {
      factory,
      startMic: mic.startMic,
      now: () => 0,
      visibility: fakeVisibility(),
    });
    const states: EngineState[] = [];
    engine.subscribe((s) => states.push(s));
    return { mic, store, engine, states, factory };
  }
  const G1 = 440 * 2 ** ((31 - 69) / 12);

  it('is off by default: G1 is not shown', async () => {
    const { engine, mic, store, factory } = setup();
    await engine.start(settings);
    expect(factory).toHaveBeenLastCalledWith(expect.any(Number), { lowRange: false });
    mic.feedSine(G1, 4096 + 512 * 8);
    expect(store.getNote()).toBeNull();
  });

  it('builds a long-frame analyzer for the next session', async () => {
    const { engine, mic, store, factory } = setup();
    await engine.setLowRange(true);
    expect(mic.startMic).not.toHaveBeenCalled();
    await engine.start(settings);
    expect(factory).toHaveBeenLastCalledWith(expect.any(Number), { lowRange: true });
    mic.feedSine(G1, 4096 + 512 * 8);
    expect(store.getNote()?.stableMidi).toBe(31);
  });

  it('restarts a running session when switched', async () => {
    const { engine, mic, store, states, factory } = setup();
    await engine.start(settings);
    await engine.setLowRange(true);
    expect(mic.stop).toHaveBeenCalledTimes(1);
    expect(mic.startMic).toHaveBeenCalledTimes(2);
    expect(factory).toHaveBeenLastCalledWith(expect.any(Number), { lowRange: true });
    expect(states.map((s) => s.status)).toEqual(['running']);
    mic.feedSine(G1, 4096 + 512 * 8);
    expect(store.getNote()?.stableMidi).toBe(31);

    // Same value: nothing happens.
    await engine.setLowRange(true);
    expect(mic.startMic).toHaveBeenCalledTimes(2);
    await engine.setLowRange(false);
    expect(factory).toHaveBeenLastCalledWith(expect.any(Number), { lowRange: false });
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

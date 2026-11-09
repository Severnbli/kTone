import { describe, expect, it } from 'vitest';
import { DEBUG_WINDOW, DebugStats, debugRequested, formatSnapshot } from './debugStats';
import { contextLatency } from './mic';

const noLatency = () => ({ baseLatency: null, outputLatency: null });

describe('DebugStats', () => {
  it('keeps mean and max over the last window and restarts per session', () => {
    const d = new DebugStats();
    d.start(48000, 2048, 512, noLatency);
    expect(d.snapshot()).toMatchObject({ frames: 0, analysisMeanMs: 0, analysisMaxMs: 0 });
    d.record(1, 0);
    d.record(3, 1);
    expect(d.snapshot()).toMatchObject({
      frames: 2,
      analysisMeanMs: 2,
      analysisMaxMs: 3,
      dropped: 1,
    });
    // The 3 ms frame falls out of the window.
    for (let i = 0; i < DEBUG_WINDOW; i++) d.record(0.5, 1);
    expect(d.snapshot()).toMatchObject({ analysisMeanMs: 0.5, analysisMaxMs: 0.5 });
    d.start(44100, 2048, 512, () => ({ baseLatency: 0.01, outputLatency: 0.02 }));
    expect(d.snapshot()).toMatchObject({
      frames: 0,
      dropped: 0,
      sampleRate: 44100,
      latency: { baseLatency: 0.01, outputLatency: 0.02 },
    });
  });

  it('formats one console line', () => {
    const d = new DebugStats();
    d.start(48000, 2048, 512, () => ({ baseLatency: 0.0107, outputLatency: null }));
    d.record(0.4, 0);
    expect(formatSnapshot(d.snapshot())).toBe(
      'kTone latency: analysis 0.40 / 0.40 ms (mean / max, hop 10.7 ms), dropped 0 of 1 frames, ' +
        'baseLatency 10.7 ms, outputLatency n/a, 48000 Hz, frame 2048 / hop 512',
    );
  });
});

describe('debugRequested', () => {
  it.each([
    ['', false],
    ['?debug', true],
    ['?debug=1', true],
    ['?lang=ru&debug', true],
    ['?debug=0', false],
    ['?debug=false', false],
    ['?debugger', false],
  ])('%s -> %s', (search, expected) => {
    expect(debugRequested(search)).toBe(expected);
  });
});

describe('contextLatency', () => {
  it('reports finite values and null for missing ones', () => {
    expect(contextLatency({ baseLatency: 0.005, outputLatency: 0.03 })).toEqual({
      baseLatency: 0.005,
      outputLatency: 0.03,
    });
    expect(contextLatency({ outputLatency: NaN })).toEqual({
      baseLatency: null,
      outputLatency: null,
    });
  });
});

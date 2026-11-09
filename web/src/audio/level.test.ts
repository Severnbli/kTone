import { describe, expect, it, vi } from 'vitest';
import {
  ANALYZER_GATE_DBFS,
  CLIP_HOLD_MS,
  HINT_EXIT_MS,
  LOUD_ENTER_MS,
  LevelHints,
  LevelStore,
  QUIET_ENTER_MS,
  measureLevel,
  meterPercent,
  toDbfs,
  type Level,
} from './level';

const HOP_MS = 10;

function sine(amplitude: number, n = 2048, hz = 440, sr = 48000): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / sr);
  return out;
}

/** Amplitude of a sine whose RMS is `db` dBFS. */
const ampForRms = (db: number) => Math.SQRT2 * Math.pow(10, db / 20);

describe('toDbfs / measureLevel', () => {
  it('converts linear values', () => {
    expect(toDbfs(1)).toBe(0);
    expect(toDbfs(0.5)).toBeCloseTo(-6.02, 2);
    expect(toDbfs(0)).toBe(-Infinity);
    expect(ANALYZER_GATE_DBFS).toBeCloseTo(-46.02, 2);
  });

  it.each([0.5, 0.1, 0.01, 1])('measures a sine of amplitude %f', (amp) => {
    const level = measureLevel(sine(amp), { rmsDb: 0, peak: 0 });
    // A sine's RMS is amplitude / √2, i.e. 3.01 dB below its peak.
    expect(level.rmsDb).toBeCloseTo(toDbfs(amp) - 3.01, 1);
    expect(level.peak).toBeCloseTo(amp, 3);
  });

  it('reports digital silence as −Infinity and an empty frame too', () => {
    expect(measureLevel(new Float32Array(2048), { rmsDb: 0, peak: 1 })).toEqual({
      rmsDb: -Infinity,
      peak: 0,
    });
    expect(measureLevel(new Float32Array(0), { rmsDb: 0, peak: 1 }).rmsDb).toBe(-Infinity);
  });

  it('counts negative samples for the peak', () => {
    const f = new Float32Array(4);
    f[2] = -0.9;
    expect(measureLevel(f, { rmsDb: 0, peak: 0 }).peak).toBeCloseTo(0.9);
  });

  it('writes into the given object', () => {
    const out: Level = { rmsDb: 0, peak: 0 };
    expect(measureLevel(sine(0.5), out)).toBe(out);
  });
});

describe('meterPercent', () => {
  it('maps −70..0 dBFS to 0..100 % and clamps', () => {
    expect(meterPercent(-Infinity)).toBe(0);
    expect(meterPercent(-80)).toBe(0);
    expect(meterPercent(-35)).toBe(50);
    expect(meterPercent(0)).toBe(100);
    expect(meterPercent(3)).toBe(100);
    expect(meterPercent(NaN)).toBe(0);
  });
});

describe('LevelHints', () => {
  const quiet: Level = { rmsDb: -55, peak: ampForRms(-55) };
  const loudEnough: Level = { rmsDb: -20, peak: 0.14 };
  const noise: Level = { rmsDb: -66, peak: 0.001 };
  const clipped: Level = { rmsDb: -3, peak: 1 };

  /** Feeds `level` every HOP_MS from `t` for `ms`; returns the end time. */
  function run(h: LevelHints, level: Level, voiced: boolean, t: number, ms: number): number {
    for (let end = t + ms; t <= end; t += HOP_MS) h.update(level, voiced, t);
    return t - HOP_MS;
  }

  it('shows "quiet" after the level sits between the floor and the gate for 1 s', () => {
    const h = new LevelHints();
    const t = run(h, quiet, false, 0, QUIET_ENTER_MS - HOP_MS);
    expect(h.hint).toBe('none');
    run(h, quiet, false, t + HOP_MS, HOP_MS);
    expect(h.hint).toBe('quiet');
  });

  it('does not show "quiet" for room noise, a found pitch, or a loud unpitched sound', () => {
    for (const [level, voiced] of [
      [noise, false],
      [quiet, true],
      [loudEnough, false],
      [{ rmsDb: -Infinity, peak: 0 }, false],
    ] as [Level, boolean][]) {
      const h = new LevelHints();
      run(h, level, voiced, 0, 3000);
      expect(h.hint).toBe('none');
    }
  });

  it('needs the condition without interruption', () => {
    const h = new LevelHints();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      t = run(h, quiet, false, t, 500);
      t = run(h, quiet, true, t + HOP_MS, HOP_MS) + HOP_MS;
    }
    expect(h.hint).toBe('none');
  });

  it('keeps the hint through short breaks and hides it after 1 s without the condition', () => {
    const h = new LevelHints();
    let t = run(h, quiet, false, 0, 1500);
    expect(h.hint).toBe('quiet');
    // Short breaks (e.g. one pitched frame, a breath) do not hide it.
    for (let i = 0; i < 5; i++) {
      t = run(h, noise, false, t + HOP_MS, 300);
      t = run(h, quiet, false, t + HOP_MS, 50);
    }
    expect(h.hint).toBe('quiet');
    t = run(h, quiet, true, t + HOP_MS, HINT_EXIT_MS - HOP_MS);
    expect(h.hint).toBe('quiet');
    run(h, quiet, true, t + HOP_MS, HOP_MS);
    expect(h.hint).toBe('none');
  });

  it('shows "loud" after clipping for a while, holding over unclipped frames', () => {
    const h = new LevelHints();
    let t = 0;
    // Clipping every third frame keeps the condition alive.
    for (; t <= LOUD_ENTER_MS; t += HOP_MS) h.update(t % 30 === 0 ? clipped : loudEnough, true, t);
    expect(h.hint).toBe('loud');
    t = run(h, loudEnough, true, t, CLIP_HOLD_MS + HINT_EXIT_MS - 2 * HOP_MS);
    expect(h.hint).toBe('loud');
    run(h, loudEnough, true, t + HOP_MS, 2 * HOP_MS);
    expect(h.hint).toBe('none');
  });

  it('ignores a single clipped frame', () => {
    const h = new LevelHints();
    h.update(clipped, true, 0);
    run(h, loudEnough, true, HOP_MS, 3000);
    expect(h.hint).toBe('none');
  });

  it('takes the gate as an option and resets', () => {
    const h = new LevelHints({ gateDbfs: -60, floorDbfs: -70 });
    run(h, quiet, false, 0, 2000);
    expect(h.hint).toBe('none');
    run(h, noise, false, 2010, 2000);
    expect(h.hint).toBe('quiet');
    h.reset();
    expect(h.hint).toBe('none');
  });
});

describe('LevelStore', () => {
  it('publishes the level of every frame and the hint only on change', () => {
    const store = new LevelStore();
    const onLevel = vi.fn();
    const onHint = vi.fn();
    store.subscribeLevel(onLevel);
    store.subscribeHint(onHint);
    const frame = sine(ampForRms(-55));
    for (let t = 0; t <= 1500; t += HOP_MS) store.push(frame, false, t);
    expect(store.level.rmsDb).toBeCloseTo(-55, 1);
    expect(onLevel).toHaveBeenCalledTimes(151);
    expect(store.getHint()).toBe('quiet');
    expect(onHint).toHaveBeenCalledTimes(1);

    store.reset();
    expect(store.level).toEqual({ rmsDb: -Infinity, peak: 0 });
    expect(store.getHint()).toBe('none');
    expect(onHint).toHaveBeenCalledTimes(2);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  CLIP_HOLD_MS,
  HINT_EXIT_MS,
  LOUD_ENTER_MS,
  LevelHints,
  LevelStore,
  NOISY_ENTER_MS,
  NOISY_GATE_DBFS,
  QUIET_ENTER_MS,
  measureLevel,
  meterPercent,
  toDbfs,
  type GateLevels,
  type Level,
} from './level';
import { GATE_MAX_DBFS } from '../engine/noiseFloor';

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
  const quiet: Level = { rmsDb: -58, peak: ampForRms(-58) };
  const loudEnough: Level = { rmsDb: -20, peak: 0.14 };
  const noise: Level = { rmsDb: -66, peak: 0.001 };
  const clipped: Level = { rmsDb: -3, peak: 1 };

  /** A quiet room: floor −66 dBFS, gate −55 dBFS. */
  const room: GateLevels = { gateDb: -55, floorDb: -66 };

  /** Feeds `level` every HOP_MS from `t` for `ms`; returns the end time. */
  function run(
    h: LevelHints,
    level: Level,
    voiced: boolean,
    t: number,
    ms: number,
    gate: GateLevels = room,
  ): number {
    for (let end = t + ms; t <= end; t += HOP_MS) h.update(level, voiced, t, gate);
    return t - HOP_MS;
  }

  it('shows "quiet" after the level sits above the floor and below the gate for 1 s', () => {
    const h = new LevelHints();
    const t = run(h, quiet, false, 0, QUIET_ENTER_MS - HOP_MS);
    expect(h.hint).toBe('none');
    run(h, quiet, false, t + HOP_MS, HOP_MS);
    expect(h.hint).toBe('quiet');
  });

  it('does not show "quiet" for room noise, a found pitch, or a loud unpitched sound', () => {
    for (const [level, voiced] of [
      [noise, false],
      [{ rmsDb: -63, peak: 0.001 }, false],
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
    for (; t <= LOUD_ENTER_MS; t += HOP_MS)
      h.update(t % 30 === 0 ? clipped : loudEnough, true, t, room);
    expect(h.hint).toBe('loud');
    t = run(h, loudEnough, true, t, CLIP_HOLD_MS + HINT_EXIT_MS - 2 * HOP_MS);
    expect(h.hint).toBe('loud');
    run(h, loudEnough, true, t + HOP_MS, 2 * HOP_MS);
    expect(h.hint).toBe('none');
  });

  it('ignores a single clipped frame', () => {
    const h = new LevelHints();
    h.update(clipped, true, 0, room);
    run(h, loudEnough, true, HOP_MS, 3000);
    expect(h.hint).toBe('none');
  });

  it('follows the live gate and floor and resets', () => {
    const h = new LevelHints();
    // A quieter room: the same level is now above the gate.
    run(h, quiet, false, 0, 2000, { gateDb: -60, floorDb: -71 });
    expect(h.hint).toBe('none');
    run(h, noise, false, 2010, 2000, { gateDb: -60, floorDb: -71 });
    expect(h.hint).toBe('quiet');
    h.reset();
    expect(h.hint).toBe('none');
  });

  it('shows no "quiet" hint while the floor is unknown', () => {
    const h = new LevelHints();
    run(h, quiet, false, 0, 3000, { gateDb: -46, floorDb: null });
    expect(h.hint).toBe('none');
  });

  it('shows "noisy" after the gate stays near its maximum for a few seconds', () => {
    expect(NOISY_GATE_DBFS).toBe(GATE_MAX_DBFS - 3);
    const noisy: GateLevels = { gateDb: GATE_MAX_DBFS, floorDb: -42 };
    const roomNoise: Level = { rmsDb: -41, peak: 0.02 };
    const h = new LevelHints();
    let t = run(h, roomNoise, false, 0, NOISY_ENTER_MS - HOP_MS, noisy);
    expect(h.hint).toBe('none');
    t = run(h, roomNoise, false, t + HOP_MS, HOP_MS, noisy);
    expect(h.hint).toBe('noisy');
    // Singing above the gate keeps it; a soft voice below the gate gets "quiet".
    t = run(h, { rmsDb: -25, peak: 0.1 }, true, t + HOP_MS, 2000, noisy);
    expect(h.hint).toBe('noisy');
    t = run(h, { rmsDb: -37, peak: 0.02 }, false, t + HOP_MS, QUIET_ENTER_MS, noisy);
    expect(h.hint).toBe('quiet');
    // The room quiets down: the hint goes away.
    run(h, noise, false, t + HOP_MS, HINT_EXIT_MS + HOP_MS);
    expect(h.hint).toBe('none');
  });

  it('does not call a moderately noisy room noisy', () => {
    const h = new LevelHints();
    run(h, noise, false, 0, 10_000, { gateDb: NOISY_GATE_DBFS - 0.5, floorDb: -48 });
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
    const frame = sine(ampForRms(-58));
    // Linear gate −55 dBFS and floor −66 dBFS, as the analyzer reports them.
    for (let t = 0; t <= 1500; t += HOP_MS) store.push(frame, false, t, 10 ** (-55 / 20), 0.0005);
    expect(store.level.rmsDb).toBeCloseTo(-58, 1);
    expect(store.level.gateDb).toBeCloseTo(-55, 5);
    expect(store.level.floorDb).toBeCloseTo(-66.02, 2);
    expect(onLevel).toHaveBeenCalledTimes(151);
    expect(store.getHint()).toBe('quiet');
    expect(onHint).toHaveBeenCalledTimes(1);

    store.push(frame, false, 1510, 0.005, null);
    expect(store.level.floorDb).toBeNull();

    store.reset();
    expect(store.level).toEqual({ rmsDb: -Infinity, peak: 0, gateDb: null, floorDb: null });
    expect(store.getHint()).toBe('none');
    expect(onHint).toHaveBeenCalledTimes(2);
  });
});

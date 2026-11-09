// Input level of the raw microphone signal, measured on every analysis frame
// whether or not a pitch was found, together with the analyzer's live noise
// floor and gate, plus the "too quiet" / "too loud" / "noisy room" hints.
// Everything here is allocation-free per frame. Rules and numbers are recorded
// in docs/decisions.md ("Input level meter and hints", "Automatic noise gate").

import { GATE_MAX_DBFS } from '../engine/noiseFloor';

/** "Too quiet" needs the level at least this far above the noise floor. */
export const QUIET_ABOVE_FLOOR_DB = 4;
/** A gate this close to its upper bound means a noisy room (about −37 dBFS). */
export const NOISY_GATE_DBFS = GATE_MAX_DBFS - 3;
/** A sample at or above this magnitude counts as clipping (about −0.2 dBFS). */
export const CLIP_PEAK = 0.98;
/** A clipped frame keeps the "clipping" condition true for this long. */
export const CLIP_HOLD_MS = 250;
/** How long "too quiet" must hold before the hint appears. */
export const QUIET_ENTER_MS = 1000;
/** How long clipping must hold before the "too loud" hint appears. */
export const LOUD_ENTER_MS = 300;
/** How long the gate must stay near its maximum before the "noisy room" hint appears. */
export const NOISY_ENTER_MS = 3000;
/** How long a hint's condition must be gone before the hint disappears. */
export const HINT_EXIT_MS = 1000;

/** Lower end of the meter scale. */
export const METER_MIN_DBFS = -70;

/** dBFS of a linear value relative to full scale 1.0: 1 -> 0 dB, 0 -> −Infinity. */
export function toDbfs(linear: number): number {
  return linear > 0 ? 20 * Math.log10(linear) : -Infinity;
}

export interface Level {
  /** RMS in dBFS; −Infinity for digital silence. */
  rmsDb: number;
  /** Largest absolute sample, linear 0..1+. */
  peak: number;
}

/** The analyzer's gate and noise floor in dBFS; null while unknown. */
export interface GateLevels {
  gateDb: number | null;
  floorDb: number | null;
}

export interface InputLevel extends Level, GateLevels {}

/** Measures `frame` into `out` (no allocation) and returns it. */
export function measureLevel(frame: Float32Array, out: Level): Level {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < frame.length; i++) {
    const v = frame[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  out.rmsDb = frame.length > 0 ? toDbfs(Math.sqrt(sum / frame.length)) : -Infinity;
  out.peak = peak;
  return out;
}

/** Position of a dBFS value on the meter, 0..100 %. */
export function meterPercent(db: number, minDb = METER_MIN_DBFS): number {
  if (!(db > minDb)) return 0;
  return Math.min(100, ((db - minDb) / -minDb) * 100);
}

export type LevelHint = 'none' | 'quiet' | 'loud' | 'noisy';

const ENTER_MS: Record<LevelHint, number> = {
  none: HINT_EXIT_MS,
  quiet: QUIET_ENTER_MS,
  loud: LOUD_ENTER_MS,
  noisy: NOISY_ENTER_MS,
};

/**
 * Hint state machine with time hysteresis. The raw condition per frame, in
 * this order:
 * - `loud`: a clipped sample within the last CLIP_HOLD_MS;
 * - `noisy`: the gate is within 3 dB of its upper bound (a noisy room). It
 *   wins over `quiet`: noise fluctuations would look like a quiet singer, and
 *   the hint already says that quiet notes may be missed;
 * - `quiet`: no pitch, and the level is at least QUIET_ABOVE_FLOOR_DB above
 *   the analyzer's noise floor but below its gate (unknown floor: never);
 * - `none`: anything else.
 * The shown hint switches to a new raw condition only after it has held
 * without interruption for its ENTER_MS (HINT_EXIT_MS for `none`), so it
 * never flickers.
 */
export class LevelHints {
  private shown: LevelHint = 'none';
  private candidate: LevelHint = 'none';
  private since = -Infinity;
  private lastClipMs = -Infinity;

  get hint(): LevelHint {
    return this.shown;
  }

  update(level: Level, voiced: boolean, nowMs: number, gate: GateLevels): LevelHint {
    if (level.peak >= CLIP_PEAK) this.lastClipMs = nowMs;
    const { gateDb, floorDb } = gate;
    let raw: LevelHint = 'none';
    if (nowMs - this.lastClipMs <= CLIP_HOLD_MS) raw = 'loud';
    else if (gateDb !== null && gateDb >= NOISY_GATE_DBFS) raw = 'noisy';
    else if (
      !voiced &&
      gateDb !== null &&
      floorDb !== null &&
      level.rmsDb >= floorDb + QUIET_ABOVE_FLOOR_DB &&
      level.rmsDb < gateDb
    )
      raw = 'quiet';

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = nowMs;
    }
    if (raw !== this.shown && nowMs - this.since >= ENTER_MS[raw]) this.shown = raw;
    return this.shown;
  }

  reset(): void {
    this.shown = 'none';
    this.candidate = 'none';
    this.since = -Infinity;
    this.lastClipMs = -Infinity;
  }
}

/**
 * Holds the latest input level outside React. The meter subscribes per frame
 * and updates the DOM directly; React re-renders only when the hint changes.
 */
export class LevelStore {
  /** Latest level, gate and floor; −Infinity / 0 / null while stopped. */
  readonly level: InputLevel = { rmsDb: -Infinity, peak: 0, gateDb: null, floorDb: null };
  private readonly hints = new LevelHints();
  private readonly levelListeners = new Set<() => void>();
  private readonly hintListeners = new Set<() => void>();

  /**
   * Measures one analysis frame. `voiced` is whether the analyzer found a
   * pitch; `gate` and `noiseFloor` are the analyzer's live values after this
   * frame (linear RMS, `noiseFloor` null while unknown).
   */
  push(
    frame: Float32Array,
    voiced: boolean,
    nowMs: number,
    gate: number,
    noiseFloor: number | null,
  ): void {
    measureLevel(frame, this.level);
    this.level.gateDb = gate > 0 ? toDbfs(gate) : null;
    this.level.floorDb = noiseFloor !== null && noiseFloor > 0 ? toDbfs(noiseFloor) : null;
    const before = this.hints.hint;
    if (this.hints.update(this.level, voiced, nowMs, this.level) !== before) {
      this.hintListeners.forEach((l) => l());
    }
    this.levelListeners.forEach((l) => l());
  }

  reset(): void {
    this.level.rmsDb = -Infinity;
    this.level.peak = 0;
    this.level.gateDb = null;
    this.level.floorDb = null;
    const before = this.hints.hint;
    this.hints.reset();
    if (before !== 'none') this.hintListeners.forEach((l) => l());
    this.levelListeners.forEach((l) => l());
  }

  subscribeLevel = (listener: () => void): (() => void) => {
    this.levelListeners.add(listener);
    return () => this.levelListeners.delete(listener);
  };

  subscribeHint = (listener: () => void): (() => void) => {
    this.hintListeners.add(listener);
    return () => this.hintListeners.delete(listener);
  };

  getHint = (): LevelHint => this.hints.hint;
}

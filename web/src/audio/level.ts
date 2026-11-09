// Input level of the raw microphone signal, measured on every analysis frame
// whether or not a pitch was found, plus the "too quiet" / "too loud" hints.
// Everything here is allocation-free per frame. Rules and numbers are recorded
// in docs/decisions.md ("Input level meter and hints").

/**
 * RMS gate of the Rust analyzer (`core/src/pitch`, `rms_threshold`): frames
 * quieter than this are never pitched. Keep in sync with the core. A future
 * noise calibration will replace this constant with a measured value, so
 * consumers take the gate as a parameter.
 */
export const ANALYZER_GATE_RMS = 0.005;
/** The gate in dBFS (about −46). */
export const ANALYZER_GATE_DBFS = toDbfs(ANALYZER_GATE_RMS);

/** Below this the input is treated as room noise, not a quiet singer. */
export const QUIET_FLOOR_DBFS = -60;
/** A sample at or above this magnitude counts as clipping (about −0.2 dBFS). */
export const CLIP_PEAK = 0.98;
/** A clipped frame keeps the "clipping" condition true for this long. */
export const CLIP_HOLD_MS = 250;
/** How long "too quiet" must hold before the hint appears. */
export const QUIET_ENTER_MS = 1000;
/** How long clipping must hold before the "too loud" hint appears. */
export const LOUD_ENTER_MS = 300;
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

export type LevelHint = 'none' | 'quiet' | 'loud';

export interface LevelHintOptions {
  gateDbfs?: number;
  floorDbfs?: number;
}

/**
 * Hint state machine with time hysteresis. The raw condition per frame:
 * - `loud`: a clipped sample within the last CLIP_HOLD_MS;
 * - `quiet`: no pitch, and the level is between the noise floor and the gate;
 * - `none`: anything else.
 * The shown hint switches to a new raw condition only after it has held
 * without interruption for QUIET_ENTER_MS / LOUD_ENTER_MS (or HINT_EXIT_MS
 * for `none`), so it never flickers.
 */
export class LevelHints {
  private shown: LevelHint = 'none';
  private candidate: LevelHint = 'none';
  private since = -Infinity;
  private lastClipMs = -Infinity;
  private readonly gateDbfs: number;
  private readonly floorDbfs: number;

  constructor(options: LevelHintOptions = {}) {
    this.gateDbfs = options.gateDbfs ?? ANALYZER_GATE_DBFS;
    this.floorDbfs = options.floorDbfs ?? QUIET_FLOOR_DBFS;
  }

  get hint(): LevelHint {
    return this.shown;
  }

  update(level: Level, voiced: boolean, nowMs: number): LevelHint {
    if (level.peak >= CLIP_PEAK) this.lastClipMs = nowMs;
    let raw: LevelHint = 'none';
    if (nowMs - this.lastClipMs <= CLIP_HOLD_MS) raw = 'loud';
    else if (!voiced && level.rmsDb >= this.floorDbfs && level.rmsDb < this.gateDbfs) raw = 'quiet';

    if (raw !== this.candidate) {
      this.candidate = raw;
      this.since = nowMs;
    }
    if (raw !== this.shown) {
      const wait = raw === 'none' ? HINT_EXIT_MS : raw === 'loud' ? LOUD_ENTER_MS : QUIET_ENTER_MS;
      if (nowMs - this.since >= wait) this.shown = raw;
    }
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
  /** Latest level; −Infinity / 0 while stopped. */
  readonly level: Level = { rmsDb: -Infinity, peak: 0 };
  private readonly hints: LevelHints;
  private readonly levelListeners = new Set<() => void>();
  private readonly hintListeners = new Set<() => void>();

  constructor(options: LevelHintOptions = {}) {
    this.hints = new LevelHints(options);
  }

  /** Measures one analysis frame. `voiced` is whether the analyzer found a pitch. */
  push(frame: Float32Array, voiced: boolean, nowMs: number): void {
    measureLevel(frame, this.level);
    const before = this.hints.hint;
    if (this.hints.update(this.level, voiced, nowMs) !== before) {
      this.hintListeners.forEach((l) => l());
    }
    this.levelListeners.forEach((l) => l());
  }

  reset(): void {
    this.level.rmsDb = -Infinity;
    this.level.peak = 0;
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

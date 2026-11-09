// Automatic noise gate for the TS mock: a port of `NoiseFloor` and
// `PitchTracker::gate` in the Rust core (`core/src/pitch/mod.rs`). The real
// engine reports its own floor and gate; the UI never computes them.
//
// Minimum statistics: the floor is the quietest frame RMS over the last
// NOISE_WINDOW_SECS of unpitched frames, kept as NOISE_SUBWINDOWS sub-window
// minima. Pitched frames and the NOISE_HOLDOFF_SECS after them never raise it,
// any quieter frame lowers it at once. Allocation-free per frame.

/** Gate used until the floor has settled (`rms_threshold` in the core, about −46 dBFS). */
export const DEFAULT_GATE_RMS = 0.005;
export const NOISE_WINDOW_SECS = 1.5;
export const NOISE_SETTLE_SECS = 0.5;
export const NOISE_HOLDOFF_SECS = 0.3;
export const NOISE_SUBWINDOWS = 6;
export const GATE_MARGIN_DB = 11;
export const GATE_MIN_DBFS = -60;
export const GATE_MAX_DBFS = -34;

const dbToLinear = (db: number): number => 10 ** (db / 20);

export class NoiseFloor {
  private readonly minima = new Float64Array(NOISE_SUBWINDOWS);
  private filled = 0;
  private pos = 0;
  private current = Infinity;
  private currentLen = 0;
  private counted = 0;
  private holdoffLeft = 0;
  private readonly subLen: number;
  private readonly settle: number;
  private readonly holdoff: number;

  constructor(sampleRate: number, hop: number) {
    const frames = (secs: number) => Math.max(1, Math.round((secs * sampleRate) / hop) || 1);
    this.subLen = Math.ceil(frames(NOISE_WINDOW_SECS) / NOISE_SUBWINDOWS);
    this.settle = frames(NOISE_SETTLE_SECS);
    this.holdoff = frames(NOISE_HOLDOFF_SECS);
  }

  reset(): void {
    this.filled = 0;
    this.pos = 0;
    this.current = Infinity;
    this.currentLen = 0;
    this.counted = 0;
    this.holdoffLeft = 0;
  }

  /** Feeds one analyzed frame: its RMS and whether it had a confident pitch. */
  push(rms: number, pitched: boolean): void {
    if (!(Number.isFinite(rms) && rms > 0)) return;
    if (pitched || this.holdoffLeft > 0) {
      if (pitched) this.holdoffLeft = this.holdoff;
      else this.holdoffLeft--;
      if (rms < this.raw()) this.current = rms;
      return;
    }
    this.current = Math.min(this.current, rms);
    this.currentLen++;
    this.counted++;
    if (this.currentLen >= this.subLen) {
      this.minima[this.pos] = this.current;
      this.pos = (this.pos + 1) % NOISE_SUBWINDOWS;
      this.filled = Math.min(this.filled + 1, NOISE_SUBWINDOWS);
      this.current = Infinity;
      this.currentLen = 0;
    }
  }

  private raw(): number {
    let m = this.current;
    for (let i = 0; i < this.filled; i++) m = Math.min(m, this.minima[i]);
    return m;
  }

  /** Linear RMS floor, or null while it is still being measured. */
  get floor(): number | null {
    const raw = this.raw();
    return this.counted >= this.settle && Number.isFinite(raw) ? raw : null;
  }

  /** Linear RMS gate: floor + margin, clamped; the default until the floor settles. */
  get gate(): number {
    const floor = this.floor;
    if (floor === null) return DEFAULT_GATE_RMS;
    return Math.min(
      dbToLinear(GATE_MAX_DBFS),
      Math.max(dbToLinear(GATE_MIN_DBFS), floor * dbToLinear(GATE_MARGIN_DB)),
    );
  }
}

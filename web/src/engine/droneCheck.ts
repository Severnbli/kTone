// TS port of the Rust drone filter (`PitchTracker::set_drone` in core/) for
// the mock engine. See docs/decisions.md for the design and thresholds.

/** Partials of the app drone as multiples of its frequency (sine + triangle an octave up). */
export const DRONE_PARTIALS = [1, 2, 6, 10] as const;
export const DRONE_TOLERANCE_CENTS = 15;
export const DRONE_VOICE_ENERGY = 0.001;
export const DRONE_VOICE_CLARITY = 0.5;
const OCTAVE_UP_CLARITY = 0.9;
const OCTAVE_UP_WINDOW_CENTS = 60;
const MAX_PARTIAL_FRACTION = 0.45;
const DIM = 2 * DRONE_PARTIALS.length + 1;

export type DroneVerdict = 'voice' | 'voiceOctaveUp' | 'drone';

export interface Residual {
  /** Energy of the residual that repeats with the lag, as a fraction of the frame energy. */
  periodic: number;
  /** Normalized correlation of the residual at the lag (near 0 for noise). */
  clarity: number;
}

/** Least-squares removal of known partials (plus DC) and periodicity of what is left. */
export class DroneChecker {
  private readonly x: Float64Array;
  private readonly residual: Float64Array;
  private readonly g = new Float64Array(DIM * (DIM + 1));
  private readonly coef = new Float64Array(DIM);
  private readonly basis = new Float64Array(DIM);
  private readonly stepCos = new Float64Array(DRONE_PARTIALS.length);
  private readonly stepSin = new Float64Array(DRONE_PARTIALS.length);
  private readonly oscCos = new Float64Array(DRONE_PARTIALS.length);
  private readonly oscSin = new Float64Array(DRONE_PARTIALS.length);

  constructor(
    private readonly sampleRate: number,
    frameSize: number,
  ) {
    this.x = new Float64Array(frameSize);
    this.residual = new Float64Array(frameSize);
  }

  /**
   * Whether a frame with detected pitch `f0` is the drone at `droneHz`
   * leaking into the mic, a voice, or a voice an octave above `f0`.
   */
  check(frame: Float32Array, f0: number, droneHz: number): DroneVerdict {
    const cents = 1200 * Math.log2(f0 / droneHz);
    const octaves = Math.round(cents / 1200);
    const off = Math.abs(cents - 1200 * octaves);
    if (!(Math.abs(octaves) <= 1 && off <= OCTAVE_UP_WINDOW_CENTS)) return 'voice';
    const near = off <= DRONE_TOLERANCE_CENTS;
    this.load(frame);
    const lag = this.sampleRate / f0;
    const measured = f0 / 2 ** octaves;
    let halfClarity = -Infinity;
    for (const base of [measured, droneHz]) {
      const r = this.fit(base, lag);
      if (r && near && (r.periodic < DRONE_VOICE_ENERGY || r.clarity < DRONE_VOICE_CLARITY)) {
        return 'drone';
      }
      const h = r && this.residualAt(lag / 2);
      if (h) halfClarity = Math.max(halfClarity, h.clarity);
    }
    // Only on the drone pitch itself, as in the core.
    return octaves === 0 && halfClarity >= OCTAVE_UP_CLARITY ? 'voiceOctaveUp' : 'voice';
  }

  /** DC-free copy of the frame. */
  private load(frame: Float32Array): void {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i];
    const mean = sum / frame.length;
    for (let i = 0; i < this.x.length; i++) this.x[i] = (frame[i] ?? 0) - mean;
  }

  /** Removes the drone partials of `base` into `residual`; returns the residual at `lag`. */
  private fit(base: number, lag: number): Residual | null {
    const count = this.setupPartials(base);
    if (count === 0) return null;
    const dim = 2 * count + 1;
    const w = dim + 1;
    const { g, basis, x } = this;
    g.fill(0);
    basis.fill(1);
    this.resetOsc();
    for (let t = 0; t < x.length; t++) {
      this.fillBasis(count);
      for (let r = 0; r < dim; r++) {
        const br = basis[r];
        for (let c = r; c < dim; c++) g[r * w + c] += br * basis[c];
        g[r * w + dim] += br * x[t];
      }
    }
    for (let r = 0; r < dim; r++) for (let c = 0; c < r; c++) g[r * w + c] = g[c * w + r];
    if (!this.solve(dim)) return null;
    this.resetOsc();
    for (let t = 0; t < x.length; t++) {
      this.fillBasis(count);
      let fit = 0;
      for (let k = 0; k < dim; k++) fit += this.coef[k] * basis[k];
      this.residual[t] = x[t] - fit;
    }
    return this.residualAt(lag);
  }

  private setupPartials(base: number): number {
    let count = 0;
    for (const k of DRONE_PARTIALS) {
      const f = k * base;
      if (Number.isFinite(f) && f > 0 && f < MAX_PARTIAL_FRACTION * this.sampleRate) {
        const omega = (2 * Math.PI * f) / this.sampleRate;
        this.stepCos[count] = Math.cos(omega);
        this.stepSin[count] = Math.sin(omega);
        count++;
      }
    }
    return count;
  }

  private resetOsc(): void {
    this.oscCos.fill(1);
    this.oscSin.fill(0);
  }

  /** Writes cos/sin of every partial at the current sample, then advances them. */
  private fillBasis(count: number): void {
    for (let j = 0; j < count; j++) {
      const c = this.oscCos[j];
      const s = this.oscSin[j];
      this.basis[2 * j] = c;
      this.basis[2 * j + 1] = s;
      this.oscCos[j] = c * this.stepCos[j] - s * this.stepSin[j];
      this.oscSin[j] = s * this.stepCos[j] + c * this.stepSin[j];
    }
  }

  /** Gaussian elimination with partial pivoting on `g` into `coef`. */
  private solve(dim: number): boolean {
    const { g, coef } = this;
    const w = dim + 1;
    let scale = 0;
    for (let i = 0; i < dim; i++) scale = Math.max(scale, Math.abs(g[i * w + i]));
    if (!(scale > 0 && Number.isFinite(scale))) return false;
    for (let col = 0; col < dim; col++) {
      let pivot = col;
      for (let r = col + 1; r < dim; r++) {
        if (Math.abs(g[r * w + col]) > Math.abs(g[pivot * w + col])) pivot = r;
      }
      if (Math.abs(g[pivot * w + col]) <= scale * 1e-10) return false;
      for (let k = 0; k < w; k++) {
        const tmp = g[col * w + k];
        g[col * w + k] = g[pivot * w + k];
        g[pivot * w + k] = tmp;
      }
      for (let r = col + 1; r < dim; r++) {
        const f = g[r * w + col] / g[col * w + col];
        for (let k = col; k < w; k++) g[r * w + k] -= f * g[col * w + k];
      }
    }
    for (let r = dim - 1; r >= 0; r--) {
      let acc = g[r * w + dim];
      for (let k = r + 1; k < dim; k++) acc -= g[r * w + k] * coef[k];
      coef[r] = acc / g[r * w + r];
    }
    for (let k = dim; k < DIM; k++) coef[k] = 0;
    return coef.every(Number.isFinite);
  }

  private residualAt(lag: number): Residual | null {
    const n = this.x.length;
    if (!(Number.isFinite(lag) && lag >= 1 && lag <= n / 2)) return null;
    const li = Math.floor(lag);
    const frac = lag - li;
    const r = this.residual;
    const x = this.x;
    let num = 0;
    let den = 0;
    let res = 0;
    for (let t = 0; t < n - li - 1; t++) {
      const rs = r[t + li] + frac * (r[t + li + 1] - r[t + li]);
      const xs = x[t + li] + frac * (x[t + li + 1] - x[t + li]);
      num += r[t] * rs;
      den += x[t] * x[t] + xs * xs;
      res += r[t] * r[t] + rs * rs;
    }
    if (!(den > 0)) return null;
    return {
      periodic: Math.max(0, (2 * num) / den),
      clarity: res > den * 1e-12 ? Math.max(-1, Math.min(1, (2 * num) / res)) : 0,
    };
  }
}

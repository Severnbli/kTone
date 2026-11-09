// TS port of the smoothing half of the Rust `PitchTracker` (core/src/pitch):
// octave guard, 3-frame median, the note switching rule (`decide_note`), the
// vibrato center and its readiness. The mock engine feeds it the raw pitch of
// every accepted frame; keep it in step with the core (see docs/decisions.md,
// "Lower latency" and the parity tests in `parity.test.ts`).

/** Median filter length in frames (`TrackerConfig::median_window`). */
const MEDIAN_WINDOW = 3;
/** A jump of about a whole number of octaves must persist this long. */
const OCTAVE_CONFIRM_FRAMES = 4;
/** Semitones of slack for "about a whole number of octaves". */
const OCTAVE_TOLERANCE = 0.6;
const OCTAVE_GUARD_MIN_HISTORY = 3;
/** Unpitched frames in a row after which the history is dropped. */
export const GAP_RESET_FRAMES = 4;
/** Vibrato-center window (`CENTER_WINDOW_SECS`). */
const CENTER_WINDOW_SECS = 0.3;
const MAX_CENTER_WINDOW = 255;
/** The center is ready after 3/5 of its window... */
const CENTER_READY_FRACTION: [number, number] = [3, 5];
/** ... or once this many frames lie within `CENTER_READY_SPREAD` semitones. */
const CENTER_READY_MIN_FRAMES = 6;
const CENTER_READY_SPREAD = 0.08;
/** Cents past the midpoint between two notes (`hysteresis_cents`). */
const HYSTERESIS_CENTS = 30;
/** How long a swinging or unsettled note must stay past the band (`switch_dwell`). */
const SWITCH_DWELL_SECS = 0.06;
const MAX_SWITCH_DWELL = 255;
/** Summed excess past the band (semitones) that switches at once. */
const SWITCH_EXCESS = 0.3;
/** A note swings when its history turned by this much both ways. */
const SWING_TURN = 0.2;
/** Frames after an onset or a leap during which the note switches at once. */
const LEAP_TRANSIT_FRAMES = 3;

/** Rust's `f64::round`: halves away from zero. */
const round = (x: number): number => Math.sign(x) * Math.round(Math.abs(x));

/** Smoothed output for one accepted frame (MIDI at the configured reference). */
export interface TrackedNote {
  frequencyHz: number;
  midi: number;
  stableMidi: number;
  cents: number;
  centerMidi: number;
  centerCents: number;
  centerReady: boolean;
}

function frames(secs: number, sampleRate: number, hop: number, max: number): number {
  const n = Math.round((secs * sampleRate) / hop);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, n)) : 1;
}

export class NoteTracker {
  /** Accepted estimates in semitones at A4 = 440 Hz (MIDI at 440). */
  private readonly history = new Float64Array(MEDIAN_WINDOW);
  private histLen = 0;
  private histPos = 0;
  private readonly scratch = new Float64Array(MEDIAN_WINDOW);
  private pendingValue = 0;
  private pendingCount = 0;
  /** Displayed note, in the `stableA4` frame of reference. */
  private stable: number | null = null;
  private stableA4 = 0;
  private invalidRun = 0;
  /** Accepted (post octave guard, unmedianed) estimates, same units as `history`. */
  private readonly centerHist: Float64Array;
  private centerLen = 0;
  private centerPos = 0;
  private pastBand = 0;
  private pastBandDir = 0;
  private pastExcess = 0;
  private transit = false;
  private ready = false;
  private readonly switchDwell: number;

  constructor(sampleRate: number, hop: number) {
    this.centerHist = new Float64Array(
      frames(CENTER_WINDOW_SECS, sampleRate, hop, MAX_CENTER_WINDOW),
    );
    this.switchDwell = frames(SWITCH_DWELL_SECS, sampleRate, hop, MAX_SWITCH_DWELL);
  }

  /** An accepted frame with raw pitch `hz`. */
  push(hz: number, a4Hz: number): TrackedNote {
    this.invalidRun = 0;
    const raw = 69 + 12 * Math.log2(hz / 440);
    const value = this.octaveGuard(raw);
    this.pushHistory(value);
    const smoothed = this.median();
    const frequencyHz = 440 * 2 ** ((smoothed - 69) / 12);
    const midi = 69 + 12 * Math.log2(frequencyHz / a4Hz);
    if (this.stableA4 !== a4Hz) {
      this.stable = null;
      this.stableA4 = a4Hz;
    }
    const a4Shift = 12 * Math.log2(440 / a4Hz);
    const stable = this.decideNote(midi, a4Shift);
    if (this.stable !== stable) {
      // A new note: do not drag the center from the previous one.
      this.centerLen = 0;
      this.ready = false;
      this.centerPos = 0;
      this.pastBand = 0;
    }
    this.stable = stable;
    this.pushCenter(value);
    const centerMidi = this.center() + a4Shift;
    return {
      frequencyHz,
      midi,
      stableMidi: stable,
      cents: (midi - stable) * 100,
      centerMidi,
      centerCents: (centerMidi - stable) * 100,
      centerReady: this.centerReady(),
    };
  }

  /** An unpitched frame: a pause of `GAP_RESET_FRAMES` drops the history. */
  invalid(): void {
    this.invalidRun++;
    if (this.invalidRun >= GAP_RESET_FRAMES) this.clearState();
  }

  reset(): void {
    this.clearState();
    this.invalidRun = 0;
  }

  /** See `PitchTracker::decide_note` in the core. */
  private decideNote(midi: number, a4Shift: number): number {
    const s = this.stable;
    if (s === null) {
      this.transit = true;
      return round(midi);
    }
    const d = midi - s;
    if (Math.abs(d) <= 0.5) {
      this.pastBand = 0;
      return s;
    }
    if (Math.abs(d) > 1.5) {
      this.transit = true;
      return round(midi);
    }
    const dir = d > 0 ? 1 : -1;
    const band = 0.5 + HYSTERESIS_CENTS / 100;
    if (Math.abs(d) > band) {
      if (this.pastBand > 0 && this.pastBandDir === dir) {
        this.pastBand++;
        this.pastExcess += Math.abs(d) - band;
      } else {
        this.pastBand = 1;
        this.pastBandDir = dir;
        this.pastExcess = Math.abs(d) - band;
      }
    } else {
      this.pastBand = 0;
    }
    const swinging = this.swinging();
    const cap = this.centerHist.length;
    const settled = 4 * this.centerLen >= 3 * cap;
    const inTransit = this.transit && this.centerLen < LEAP_TRANSIT_FRAMES;
    const dwell = (swinging || !settled) && !inTransit ? this.switchDwell : 1;
    const excess = this.pastBand > 0 && this.pastExcess >= SWITCH_EXCESS;
    const reference = s - a4Shift;
    const centerMoved =
      !swinging && 3 * this.centerLen >= cap && dir * (this.center() - reference) > 0.5;
    if (this.pastBand >= dwell || excess || centerMoved) {
      this.transit = false;
      return s + dir;
    }
    return s;
  }

  /** See `PitchTracker::swinging` in the core. */
  private swinging(): boolean {
    let hi = -Infinity;
    let lo = Infinity;
    let valley = Infinity;
    let peak = -Infinity;
    const cap = this.centerHist.length;
    const oldest = (this.centerPos + cap - this.centerLen) % cap;
    for (let i = 0; i < this.centerLen; i++) {
      const v = this.centerHist[(oldest + i) % cap];
      if (v - valley >= SWING_TURN || peak - v >= SWING_TURN) return true;
      hi = Math.max(hi, v);
      lo = Math.min(lo, v);
      if (hi - v >= SWING_TURN) valley = Math.min(valley, v);
      if (v - lo >= SWING_TURN) peak = Math.max(peak, v);
    }
    return false;
  }

  /** See `PitchFrame.centerReady`; latched until the note changes. */
  private centerReady(): boolean {
    const len = this.centerLen;
    const cap = this.centerHist.length;
    const [num, den] = CENTER_READY_FRACTION;
    if (!this.ready && den * len >= num * cap) this.ready = true;
    if (!this.ready && len >= CENTER_READY_MIN_FRAMES) {
      const oldest = (this.centerPos + cap - len) % cap;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < len; i++) {
        const v = this.centerHist[(oldest + i) % cap];
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      this.ready = hi - lo <= CENTER_READY_SPREAD;
    }
    return this.ready;
  }

  /** See `PitchTracker::octave_guard` in the core. */
  private octaveGuard(raw: number): number {
    if (this.histLen < Math.min(OCTAVE_GUARD_MIN_HISTORY, MEDIAN_WINDOW)) {
      this.pendingCount = 0;
      return raw;
    }
    const diff = raw - this.median();
    const octaves = round(diff / 12);
    const isOctaveJump =
      octaves !== 0 && Math.abs(octaves) <= 2 && Math.abs(diff - 12 * octaves) < OCTAVE_TOLERANCE;
    if (!isOctaveJump) {
      this.pendingCount = 0;
      return raw;
    }
    if (this.pendingCount > 0 && Math.abs(raw - this.pendingValue) < OCTAVE_TOLERANCE) {
      this.pendingCount++;
    } else {
      this.pendingCount = 1;
    }
    this.pendingValue = raw;
    if (this.pendingCount >= OCTAVE_CONFIRM_FRAMES) {
      this.pendingCount = 0;
      this.histLen = 0;
      this.histPos = 0;
      return raw;
    }
    return raw - 12 * octaves;
  }

  private pushHistory(value: number): void {
    this.history[this.histPos] = value;
    this.histPos = (this.histPos + 1) % MEDIAN_WINDOW;
    this.histLen = Math.min(this.histLen + 1, MEDIAN_WINDOW);
  }

  private pushCenter(value: number): void {
    const cap = this.centerHist.length;
    this.centerHist[this.centerPos] = value;
    this.centerPos = (this.centerPos + 1) % cap;
    this.centerLen = Math.min(this.centerLen + 1, cap);
  }

  /** Triangular-weighted mean of the center history (weights 1, 2, .., 2, 1). */
  private center(): number {
    const len = this.centerLen;
    const cap = this.centerHist.length;
    const oldest = (this.centerPos + cap - len) % cap;
    let sum = 0;
    let weights = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.min(i + 1, len - i);
      sum += w * this.centerHist[(oldest + i) % cap];
      weights += w;
    }
    return weights > 0 ? sum / weights : 0;
  }

  /** Median of the history (mean of the two middle values for an even count). */
  private median(): number {
    const len = this.histLen;
    if (len === 0) return 0;
    const s = this.scratch.subarray(0, len);
    s.set(this.history.subarray(0, len));
    s.sort();
    return len % 2 === 1 ? s[len >> 1] : 0.5 * (s[len / 2 - 1] + s[len / 2]);
  }

  private clearState(): void {
    this.histLen = 0;
    this.histPos = 0;
    this.pendingCount = 0;
    this.pendingValue = 0;
    this.stable = null;
    this.centerLen = 0;
    this.ready = false;
    this.centerPos = 0;
    this.pastBand = 0;
  }
}

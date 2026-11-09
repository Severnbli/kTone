// Holds the analyzer output outside React. Per-frame consumers (gauge needle,
// frequency readout, pitch curve) subscribe and update the DOM/canvas
// directly; React only re-renders when the displayed note itself changes.

import type { PitchFrame, SpelledNote } from '../engine/types';

export interface NoteSnapshot {
  stableMidi: number;
  note: SpelledNote;
  degree: number | null;
  inKey: boolean;
  staffStep: number;
  /** False once the singer has been silent for `SILENCE_HOLD_MS`. */
  active: boolean;
}

export const SILENCE_HOLD_MS = 350;
/** The drone leak hint shows once the mic has heard the drone this long... */
export const DRONE_LEAK_SHOW_MS = 1500;
/** ... and hides when no leaking frame came for this long. */
export const DRONE_LEAK_GAP_MS = 500;
export const HISTORY_CAPACITY = 2048;

type FrameListener = (frame: PitchFrame | null) => void;

/** Fixed-size history ring used by the pitch curve. NaN marks unpitched frames. */
export class PitchHistory {
  readonly time = new Float64Array(HISTORY_CAPACITY);
  /** Raw per-frame pitch: the curve draws this so vibrato stays visible. */
  readonly midi = new Float32Array(HISTORY_CAPACITY);
  readonly stable = new Float32Array(HISTORY_CAPACITY);
  /** Vibrato-center deviation in cents: the curve colors segments by this. */
  readonly centerCents = new Float32Array(HISTORY_CAPACITY);
  /** 1 when the center was ready to judge (`PitchFrame.centerReady`), else 0. */
  readonly centerReady = new Uint8Array(HISTORY_CAPACITY);
  /** Index of the next write. */
  head = 0;
  size = 0;

  push(timeMs: number, frame: PitchFrame | null): void {
    this.time[this.head] = timeMs;
    this.midi[this.head] = frame ? frame.midi : NaN;
    this.stable[this.head] = frame ? frame.stableMidi : NaN;
    this.centerCents[this.head] = frame ? frame.centerCents : NaN;
    this.centerReady[this.head] = frame?.centerReady ? 1 : 0;
    this.head = (this.head + 1) % HISTORY_CAPACITY;
    if (this.size < HISTORY_CAPACITY) this.size++;
  }

  /** Physical index of the i-th oldest entry. */
  at(i: number): number {
    return (this.head - this.size + i + HISTORY_CAPACITY) % HISTORY_CAPACITY;
  }

  clear(): void {
    this.head = 0;
    this.size = 0;
  }
}

function sameSnapshot(a: NoteSnapshot | null, b: NoteSnapshot | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.stableMidi === b.stableMidi &&
    a.note.letter === b.note.letter &&
    a.note.accidental === b.note.accidental &&
    a.note.octave === b.note.octave &&
    a.degree === b.degree &&
    a.inKey === b.inKey &&
    a.staffStep === b.staffStep &&
    a.active === b.active
  );
}

export class PitchStore {
  latest: PitchFrame | null = null;
  readonly history = new PitchHistory();
  private note: NoteSnapshot | null = null;
  private lastVoicedMs = -Infinity;
  private readonly frameListeners = new Set<FrameListener>();
  private readonly noteListeners = new Set<() => void>();
  private leakStartMs = -Infinity;
  private lastLeakMs = -Infinity;
  private droneLeak = false;
  private readonly leakListeners = new Set<() => void>();

  /** `droneLeak`: the analyzer heard the app drone leaking into the mic in this frame. */
  push(frame: PitchFrame | null, timeMs: number, droneLeak = false): void {
    this.updateLeak(timeMs, droneLeak);
    this.latest = frame;
    this.history.push(timeMs, frame);
    let next = this.note;
    if (frame) {
      this.lastVoicedMs = timeMs;
      next = {
        stableMidi: frame.stableMidi,
        note: frame.note,
        degree: frame.degree,
        inKey: frame.inKey,
        staffStep: frame.staffStep,
        active: true,
      };
    } else if (this.note?.active && timeMs - this.lastVoicedMs >= SILENCE_HOLD_MS) {
      next = { ...this.note, active: false };
    }
    if (!sameSnapshot(next, this.note)) {
      this.note = next;
      this.noteListeners.forEach((l) => l());
    }
    this.frameListeners.forEach((l) => l(frame));
  }

  /**
   * Leaking frames that come less than `DRONE_LEAK_GAP_MS` apart form a run;
   * the leak is reported once a run lasts `DRONE_LEAK_SHOW_MS`.
   */
  private updateLeak(timeMs: number, leak: boolean): void {
    if (leak) {
      if (timeMs - this.lastLeakMs > DRONE_LEAK_GAP_MS) this.leakStartMs = timeMs;
      this.lastLeakMs = timeMs;
    }
    const active =
      timeMs - this.lastLeakMs <= DRONE_LEAK_GAP_MS &&
      this.lastLeakMs - this.leakStartMs >= DRONE_LEAK_SHOW_MS;
    this.setDroneLeak(active);
  }

  private setDroneLeak(active: boolean): void {
    if (active === this.droneLeak) return;
    this.droneLeak = active;
    this.leakListeners.forEach((l) => l());
  }

  reset(): void {
    this.leakStartMs = -Infinity;
    this.lastLeakMs = -Infinity;
    this.setDroneLeak(false);
    this.latest = null;
    this.history.clear();
    this.lastVoicedMs = -Infinity;
    if (this.note) {
      this.note = null;
      this.noteListeners.forEach((l) => l());
    }
    this.frameListeners.forEach((l) => l(null));
  }

  subscribeFrame = (listener: FrameListener): (() => void) => {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  };

  subscribeNote = (listener: () => void): (() => void) => {
    this.noteListeners.add(listener);
    return () => this.noteListeners.delete(listener);
  };

  getNote = (): NoteSnapshot | null => this.note;

  subscribeDroneLeak = (listener: () => void): (() => void) => {
    this.leakListeners.add(listener);
    return () => this.leakListeners.delete(listener);
  };

  /** True while the mic has clearly been hearing the app drone (see `push`). */
  getDroneLeak = (): boolean => this.droneLeak;
}

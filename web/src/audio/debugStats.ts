// Latency diagnostics for the `?debug` overlay: how long each analysis frame
// takes on the main thread, how many hops the scheduler had to skip, and what
// the AudioContext reports about its own latency. Recording is cheap and
// allocation-free; nothing is recorded unless the engine is given a DebugStats.

/** Analysis times kept for the statistics (about 1 s at 48 kHz / hop 512). */
export const DEBUG_WINDOW = 94;

export interface AudioLatency {
  /** `AudioContext.baseLatency` in seconds, null when the browser does not report it. */
  baseLatency: number | null;
  /** `AudioContext.outputLatency` in seconds, null when not reported. */
  outputLatency: number | null;
}

export interface DebugSnapshot {
  /** Frames analyzed since the session started. */
  frames: number;
  /** Mean and worst analysis time (ms) over the last `DEBUG_WINDOW` frames. */
  analysisMeanMs: number;
  analysisMaxMs: number;
  /** Hops the scheduler skipped (see `FrameScheduler.dropped`). */
  dropped: number;
  latency: AudioLatency;
  sampleRate: number;
  frameSize: number;
  hopSize: number;
}

export class DebugStats {
  private readonly times = new Float64Array(DEBUG_WINDOW);
  private count = 0;
  private pos = 0;
  private frames = 0;
  private dropped = 0;
  private latency: () => AudioLatency = () => ({ baseLatency: null, outputLatency: null });
  private format = { sampleRate: 0, frameSize: 0, hopSize: 0 };

  /**
   * A new session: clears the counters and records its audio parameters.
   * `latency` is read on every snapshot (output latency can change).
   */
  start(sampleRate: number, frameSize: number, hopSize: number, latency: () => AudioLatency): void {
    this.count = 0;
    this.pos = 0;
    this.frames = 0;
    this.dropped = 0;
    this.latency = latency;
    this.format = { sampleRate, frameSize, hopSize };
  }

  /** One analyzed frame: its analysis time and the scheduler's drop counter. */
  record(analysisMs: number, dropped: number): void {
    this.times[this.pos] = analysisMs;
    this.pos = (this.pos + 1) % DEBUG_WINDOW;
    this.count = Math.min(this.count + 1, DEBUG_WINDOW);
    this.frames++;
    this.dropped = dropped;
  }

  snapshot(): DebugSnapshot {
    let sum = 0;
    let max = 0;
    for (let i = 0; i < this.count; i++) {
      sum += this.times[i];
      max = Math.max(max, this.times[i]);
    }
    return {
      frames: this.frames,
      analysisMeanMs: this.count > 0 ? sum / this.count : 0,
      analysisMaxMs: max,
      dropped: this.dropped,
      latency: this.latency(),
      ...this.format,
    };
  }
}

/** True when the page URL asks for the debug overlay (`?debug`, `?debug=1`). */
export function debugRequested(search: string): boolean {
  const value = new URLSearchParams(search).get('debug');
  return value !== null && value !== '0' && value !== 'false';
}

/** One line for the console, e.g. `kTone latency: analysis 0.41 / 1.20 ms, …`. */
export function formatSnapshot(s: DebugSnapshot): string {
  const ms = (v: number | null) => (v === null ? 'n/a' : `${(v * 1000).toFixed(1)} ms`);
  const hopMs = s.sampleRate > 0 ? ((s.hopSize / s.sampleRate) * 1000).toFixed(1) : 'n/a';
  return (
    `kTone latency: analysis ${s.analysisMeanMs.toFixed(2)} / ${s.analysisMaxMs.toFixed(2)} ms ` +
    `(mean / max, hop ${hopMs} ms), dropped ${s.dropped} of ${s.frames} frames, ` +
    `baseLatency ${ms(s.latency.baseLatency)}, outputLatency ${ms(s.latency.outputLatency)}, ` +
    `${s.sampleRate} Hz, frame ${s.frameSize} / hop ${s.hopSize}`
  );
}

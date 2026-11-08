// Glue between the microphone, the analyzer and the PitchStore. Everything
// runs on the main thread: worklet blocks arrive as messages, the scheduler
// assembles 2048-sample frames every 512 samples, `analyzer.process` runs
// synchronously, and the result lands in the store.
//
// Lifecycle rules (see docs/decisions.md):
// - mic track ended -> stop, status `idle`, stopReason `ended`;
// - mic suspended -> status `suspended`; one automatic resume attempt while the
//   page is visible (now, or when it becomes visible); otherwise the UI offers
//   `resume()` from a user gesture, which restarts the mic if resuming fails;
// - page hidden for BACKGROUND_STOP_MS -> stop, stopReason `background`.

import type { Analyzer, AnalyzerFactory, AnalyzerSettings } from '../engine/types';
import { FrameScheduler } from './frameScheduler';
import type { LevelStore } from './level';
import { documentVisibility, watchVisibility, type PageVisibility } from './lifecycle';
import type { MicSession, MicState, StartMic } from './mic';
import type { PitchStore } from './pitchStore';

export interface EngineDeps {
  factory: AnalyzerFactory;
  startMic: StartMic;
  now: () => number;
  /** Defaults to `document` visibility. */
  visibility?: PageVisibility;
  /** Defaults to BACKGROUND_STOP_MS. */
  backgroundStopMs?: number;
  /** Receives the input level of every analysis frame, pitched or not. */
  levels?: LevelStore;
}

export type EngineStatus = 'idle' | 'running' | 'suspended';
/** Why the engine last went idle: by the user, because the mic ended, or in the background. */
export type StopReason = 'user' | 'ended' | 'background';

export interface EngineState {
  status: EngineStatus;
  /** Set when status is `idle`; null before the first start and while active. */
  stopReason: StopReason | null;
}

export class PitchEngine {
  private analyzer: Analyzer | null = null;
  private mic: MicSession | null = null;
  private settings: AnalyzerSettings | null = null;
  private generation = 0;
  private current: EngineState = { status: 'idle', stopReason: null };
  private readonly listeners = new Set<(state: EngineState) => void>();
  private unwatch: (() => void) | null = null;
  private resuming = false;

  constructor(
    private readonly store: PitchStore,
    private readonly deps: EngineDeps,
  ) {}

  get running(): boolean {
    return this.mic !== null;
  }

  get state(): EngineState {
    return this.current;
  }

  /** Called after every state change. Returns an unsubscribe. */
  subscribe(listener: (state: EngineState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Must be called from a user gesture. Throws MicError or engine errors. */
  async start(settings: AnalyzerSettings): Promise<void> {
    if (this.mic) return;
    const gen = ++this.generation;
    this.settings = settings;
    let scheduler: FrameScheduler | null = null;
    const mic = await this.deps.startMic((block) => scheduler?.push(block), {
      onStateChange: (state) => this.onMicState(gen, state),
    });
    if (gen !== this.generation) {
      await mic.stop();
      return;
    }
    let analyzer: Analyzer;
    try {
      analyzer = await this.deps.factory(mic.sampleRate);
    } catch (err) {
      await mic.stop();
      throw err;
    }
    if (gen !== this.generation) {
      analyzer.dispose();
      await mic.stop();
      return;
    }
    analyzer.configure(this.settings);
    this.analyzer = analyzer;
    this.mic = mic;
    this.store.reset();
    const levels = this.deps.levels;
    levels?.reset();
    scheduler = new FrameScheduler(analyzer.frameSize, analyzer.hopSize, (frame) => {
      const now = this.deps.now();
      const result = analyzer.process(frame);
      this.store.push(result, now);
      levels?.push(frame, result !== null, now);
    });
    this.unwatch = watchVisibility(this.deps.visibility ?? documentVisibility(), {
      hiddenTimeoutMs: this.deps.backgroundStopMs,
      onHiddenTimeout: () => void this.halt('background'),
      onVisible: () => {
        if (this.current.status === 'suspended') void this.tryResume();
      },
    });
    // The mic may have changed state while the analyzer was loading.
    const state = mic.state;
    if (state === 'ended') return this.halt('ended');
    this.setState({ status: state === 'running' ? 'running' : 'suspended', stopReason: null });
    if (state === 'suspended') void this.tryResume();
  }

  /** Safe to call at any time; applied before the next frame. */
  configure(settings: AnalyzerSettings): void {
    this.settings = settings;
    this.analyzer?.configure(settings);
  }

  /**
   * Resumes a suspended engine. Call from a user gesture (iOS only resumes
   * audio from one). Restarts the mic when resuming the old session fails.
   */
  async resume(): Promise<void> {
    if (this.current.status !== 'suspended' || !this.mic) return;
    if (await this.tryResume()) return;
    const settings = this.settings;
    if (!settings || this.current.status !== 'suspended') return;
    await this.teardown();
    this.setState({ status: 'idle', stopReason: null });
    await this.start(settings);
  }

  async stop(): Promise<void> {
    await this.halt('user');
  }

  private onMicState(gen: number, state: MicState): void {
    if (gen !== this.generation || !this.mic) return;
    if (state === 'ended') {
      void this.halt('ended');
    } else if (state === 'suspended') {
      if (this.current.status === 'suspended') return;
      this.store.reset();
      this.deps.levels?.reset();
      this.setState({ status: 'suspended', stopReason: null });
      void this.tryResume();
    } else {
      this.setState({ status: 'running', stopReason: null });
    }
  }

  /** One resume attempt, only while visible. Resolves to true when running. */
  private async tryResume(): Promise<boolean> {
    const mic = this.mic;
    const visibility = this.deps.visibility ?? documentVisibility();
    if (!mic || this.resuming || visibility.hidden) return false;
    this.resuming = true;
    try {
      const ok = await mic.resume();
      if (ok && this.mic === mic) this.setState({ status: 'running', stopReason: null });
      return ok;
    } finally {
      this.resuming = false;
    }
  }

  private async halt(reason: StopReason): Promise<void> {
    const wasActive = this.mic !== null;
    await this.teardown();
    this.store.reset();
    this.deps.levels?.reset();
    if (wasActive || reason === 'user') this.setState({ status: 'idle', stopReason: reason });
  }

  private async teardown(): Promise<void> {
    this.generation++;
    const mic = this.mic;
    const analyzer = this.analyzer;
    this.mic = null;
    this.analyzer = null;
    this.unwatch?.();
    this.unwatch = null;
    await mic?.stop();
    analyzer?.dispose();
  }

  private setState(next: EngineState): void {
    if (next.status === this.current.status && next.stopReason === this.current.stopReason) return;
    this.current = next;
    this.listeners.forEach((l) => l(next));
  }
}

// Glue between the microphone, the analyzer and the PitchStore. Everything
// runs on the main thread: worklet blocks arrive as messages, the scheduler
// assembles 2048-sample frames every 512 samples, `analyzer.process` runs
// synchronously, and the result lands in the store.

import type { Analyzer, AnalyzerFactory, AnalyzerSettings } from '../engine/types';
import { FrameScheduler } from './frameScheduler';
import { startMic, type MicSession } from './mic';
import type { PitchStore } from './pitchStore';

export interface EngineDeps {
  factory: AnalyzerFactory;
  startMic: typeof startMic;
  now: () => number;
}

export class PitchEngine {
  private analyzer: Analyzer | null = null;
  private mic: MicSession | null = null;
  private settings: AnalyzerSettings | null = null;
  private generation = 0;

  constructor(
    private readonly store: PitchStore,
    private readonly deps: EngineDeps,
  ) {}

  get running(): boolean {
    return this.mic !== null;
  }

  /** Must be called from a user gesture. Throws MicError or engine errors. */
  async start(settings: AnalyzerSettings): Promise<void> {
    if (this.mic) return;
    const gen = ++this.generation;
    this.settings = settings;
    let scheduler: FrameScheduler | null = null;
    const mic = await this.deps.startMic((block) => scheduler?.push(block));
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
    scheduler = new FrameScheduler(analyzer.frameSize, analyzer.hopSize, (frame) => {
      this.store.push(analyzer.process(frame), this.deps.now());
    });
  }

  /** Safe to call at any time; applied before the next frame. */
  configure(settings: AnalyzerSettings): void {
    this.settings = settings;
    this.analyzer?.configure(settings);
  }

  async stop(): Promise<void> {
    this.generation++;
    const mic = this.mic;
    const analyzer = this.analyzer;
    this.mic = null;
    this.analyzer = null;
    await mic?.stop();
    analyzer?.dispose();
    this.store.reset();
  }
}

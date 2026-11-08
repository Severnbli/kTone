// Soft drone on the tonic: a sine plus a quiet low-passed triangle an octave
// up, with slow attack/release. Uses its own AudioContext so it works without
// the microphone. The mic is captured with echo cancellation off, so the drone
// can leak into detection through speakers; the UI recommends headphones.
// When the system pauses the context (phone call, Siri, background) the drone
// reports it via `onPause`; the owner decides whether to `resume()` or stop.

import { isContextPaused, resumeContext } from './lifecycle';

const ATTACK_S = 0.4;
const RELEASE_S = 0.3;
const RAMP_S = 0.05;

export type CreateContext = () => AudioContext | null;

const browserContext: CreateContext = () =>
  typeof AudioContext === 'undefined' ? null : new AudioContext();

export class Drone {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscs: OscillatorNode[] = [];
  private volume = 0.3;
  /** Bumped by stop/dispose so a start still awaiting resume() gives up. */
  private startGen = 0;
  /** Called when the system pauses the context while the drone is playing. */
  onPause: (() => void) | null = null;

  constructor(private readonly createContext: CreateContext = browserContext) {}

  get playing(): boolean {
    return this.oscs.length > 0;
  }

  /** True while playing but the context is suspended or interrupted. */
  get paused(): boolean {
    return this.playing && !!this.ctx && isContextPaused(this.ctx.state);
  }

  /** Must be called from a user gesture the first time. */
  async start(frequencyHz: number, volume: number): Promise<void> {
    this.stopNow();
    const gen = ++this.startGen;
    this.volume = volume;
    if (!this.ctx) {
      this.ctx = this.createContext();
      if (!this.ctx) return;
      const ctx = this.ctx;
      ctx.addEventListener('statechange', () => {
        if (this.ctx === ctx && this.paused) this.onPause?.();
      });
    }
    const ctx = this.ctx;
    await resumeContext(ctx);
    if (gen !== this.startGen || this.ctx !== ctx) return;
    const t = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(volume * 0.5, t + ATTACK_S);
    master.connect(ctx.destination);

    const fundamental = ctx.createOscillator();
    fundamental.type = 'sine';
    const upper = ctx.createOscillator();
    upper.type = 'triangle';
    const upperGain = ctx.createGain();
    upperGain.gain.value = 0.25;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 1200;
    fundamental.connect(master);
    upper.connect(upperGain).connect(lowpass).connect(master);

    this.master = master;
    this.oscs = [fundamental, upper];
    this.setFrequency(frequencyHz);
    this.oscs.forEach((o) => o.start(t));
  }

  /** Tries to resume a paused drone. Resolves to true when it is audible again. */
  async resume(): Promise<boolean> {
    if (!this.ctx || !this.playing) return false;
    return resumeContext(this.ctx);
  }

  setFrequency(frequencyHz: number): void {
    if (!this.ctx || this.oscs.length === 0) return;
    const t = this.ctx.currentTime;
    this.oscs[0].frequency.setTargetAtTime(frequencyHz, t, RAMP_S);
    this.oscs[1].frequency.setTargetAtTime(frequencyHz * 2, t, RAMP_S);
  }

  setVolume(volume: number): void {
    this.volume = volume;
    if (!this.ctx || !this.master) return;
    this.master.gain.setTargetAtTime(volume * 0.5, this.ctx.currentTime, RAMP_S);
  }

  stop(): void {
    this.startGen++;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const master = this.master;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(master.gain.value, t);
    master.gain.linearRampToValueAtTime(0, t + RELEASE_S);
    this.oscs.forEach((o) => o.stop(t + RELEASE_S + 0.05));
    this.oscs = [];
    this.master = null;
    setTimeout(() => master.disconnect(), (RELEASE_S + 0.1) * 1000);
  }

  private stopNow(): void {
    this.oscs.forEach((o) => {
      try {
        o.stop();
      } catch {
        // already stopped
      }
    });
    this.master?.disconnect();
    this.oscs = [];
    this.master = null;
  }

  async dispose(): Promise<void> {
    this.startGen++;
    this.stopNow();
    await this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  get currentVolume(): number {
    return this.volume;
  }
}

/** MIDI number of the tonic in the given scientific octave (C♭ in octave 4 is B3). */
export function droneMidi(tonicLetterPc: number, tonicAccidental: number, octave: number): number {
  return 12 * (octave + 1) + tonicLetterPc + tonicAccidental;
}

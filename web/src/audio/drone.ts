// Soft drone on the tonic: a sine plus a quiet low-passed triangle an octave
// up, with slow attack/release. Uses its own AudioContext so it works without
// the microphone. The mic is captured with echo cancellation off, so the drone
// can leak into detection through speakers; the UI recommends headphones.

const ATTACK_S = 0.4;
const RELEASE_S = 0.3;
const RAMP_S = 0.05;

export class Drone {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private oscs: OscillatorNode[] = [];
  private volume = 0.3;

  get playing(): boolean {
    return this.oscs.length > 0;
  }

  /** Must be called from a user gesture the first time. */
  async start(frequencyHz: number, volume: number): Promise<void> {
    if (typeof AudioContext === 'undefined') return;
    this.stopNow();
    this.volume = volume;
    this.ctx ??= new AudioContext();
    const ctx = this.ctx;
    await ctx.resume();
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

    // Set the pitch directly: a ramp would glide up from the 440 Hz default,
    // and the mic would hear (and show) the glide.
    fundamental.frequency.value = frequencyHz;
    upper.frequency.value = frequencyHz * 2;
    this.master = master;
    this.oscs = [fundamental, upper];
    this.oscs.forEach((o) => o.start(t));
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drone } from './drone';

class FakeParam {
  value: number;
  constructor(value = 0) {
    this.value = value;
  }
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
  cancelScheduledValues = vi.fn();
}

const oscillators: { type: string; frequency: FakeParam; start: () => void }[] = [];

class FakeAudioContext {
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
  private node() {
    return { connect: (next: unknown) => next, disconnect: vi.fn() };
  }
  createGain() {
    return { ...this.node(), gain: new FakeParam(1) };
  }
  createBiquadFilter() {
    return { ...this.node(), type: 'lowpass', frequency: new FakeParam(350) };
  }
  createOscillator() {
    // Web Audio oscillators start at 440 Hz.
    const o = { ...this.node(), type: 'sine', frequency: new FakeParam(440), start: vi.fn() };
    oscillators.push(o);
    return o;
  }
}

describe('Drone', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    oscillators.length = 0;
  });

  it('starts at its pitch instead of gliding from 440 Hz', async () => {
    vi.stubGlobal('AudioContext', FakeAudioContext);
    const drone = new Drone();
    await drone.start(146.83, 0.3);
    expect(oscillators.map((o) => [o.type, o.frequency.value])).toEqual([
      ['sine', 146.83],
      ['triangle', 293.66],
    ]);
    expect(drone.playing).toBe(true);
  });
});

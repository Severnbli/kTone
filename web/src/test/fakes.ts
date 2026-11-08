// Fakes for browser lifecycle APIs used by unit and component tests.

import { vi } from 'vitest';
import type { PageVisibility } from '../audio/lifecycle';
import type { MicOptions, MicState, StartMic } from '../audio/mic';
import type { WakeLockApi, WakeLockSentinelLike } from '../audio/wakeLock';

export const SR = 48000;

/** A controllable microphone: feed samples, flip its state, decide whether resume works. */
export function fakeMic() {
  let onBlock: ((b: Float32Array) => void) | null = null;
  let options: MicOptions = {};
  let state: MicState = 'running';
  let resumeWorks = true;
  const stop = vi.fn(async () => undefined);
  const resume = vi.fn(async () => {
    if (resumeWorks && state === 'suspended') state = 'running';
    return state === 'running';
  });
  const startMic = vi.fn<StartMic>(async (cb, opts = {}) => {
    onBlock = cb;
    options = opts;
    state = 'running';
    return {
      sampleRate: SR,
      get state() {
        return state;
      },
      resume,
      stop,
    };
  });
  let n = 0;
  const feed = (hz: number, samples: number) => {
    const block = new Float32Array(samples);
    for (let i = 0; i < samples; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * hz * n++) / SR);
    onBlock?.(block);
  };
  /** Feeds in 128-sample blocks, like the real worklet. */
  const feedSine = (hz: number, samples: number) => {
    for (let done = 0; done < samples; done += 128) feed(hz, 128);
  };
  /** Simulates a system event: the session's `onStateChange` fires. */
  const setState = (next: MicState) => {
    state = next;
    options.onStateChange?.(next);
  };
  return {
    startMic,
    stop,
    resume,
    feed,
    feedSine,
    setState,
    setResumeWorks: (works: boolean) => {
      resumeWorks = works;
    },
  };
}

export function fakeVisibility(hidden = false) {
  const listeners = new Set<() => void>();
  const visibility: PageVisibility & { set(hidden: boolean): void; readonly listeners: number } = {
    get hidden() {
      return hidden;
    },
    get listeners() {
      return listeners.size;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      hidden = next;
      listeners.forEach((l) => l());
    },
  };
  return visibility;
}

export function fakeWakeLock() {
  const sentinels: (WakeLockSentinelLike & { systemRelease(): void })[] = [];
  let refuse = false;
  const api: WakeLockApi & { refuse(v: boolean): void } = {
    request: vi.fn(async () => {
      if (refuse) throw new DOMException('no', 'NotAllowedError');
      const listeners: (() => void)[] = [];
      const sentinel = {
        released: false,
        release: vi.fn(async () => {
          if (sentinel.released) return;
          sentinel.released = true;
          listeners.forEach((l) => l());
        }),
        addEventListener: (_: 'release', l: () => void) => void listeners.push(l),
        /** The browser drops the lock (e.g. page hidden). */
        systemRelease: () => {
          sentinel.released = true;
          listeners.forEach((l) => l());
        },
      };
      sentinels.push(sentinel);
      return sentinel;
    }),
    refuse: (v) => {
      refuse = v;
    },
  };
  const held = () => sentinels.filter((s) => !s.released).length;
  return { api, sentinels, held };
}

/** Lets pending promise callbacks run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

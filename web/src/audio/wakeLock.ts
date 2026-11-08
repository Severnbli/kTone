// Keeps the screen on while the app is listening or the drone is playing.
// Several holders ('mic', 'drone') share one Screen Wake Lock sentinel. The
// browser drops the lock when the page is hidden, so it is re-requested when
// the page becomes visible again. Missing API or refused requests are ignored.

import type { PageVisibility } from './lifecycle';

export interface WakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockApi {
  request(type: 'screen'): Promise<WakeLockSentinelLike>;
}

/** `navigator.wakeLock` where supported, otherwise `null`. */
export function browserWakeLock(): WakeLockApi | null {
  if (typeof navigator === 'undefined') return null;
  const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
  return api && typeof api.request === 'function' ? api : null;
}

export class ScreenWakeLock {
  private readonly holders = new Set<string>();
  private sentinel: WakeLockSentinelLike | null = null;
  private pending = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly api: WakeLockApi | null,
    private readonly visibility: PageVisibility,
  ) {
    this.unsubscribe = visibility.subscribe(() => this.sync());
  }

  /** True while a sentinel is held. */
  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  set(holder: string, wanted: boolean): void {
    if (wanted) this.holders.add(holder);
    else this.holders.delete(holder);
    this.sync();
  }

  dispose(): void {
    this.unsubscribe();
    this.holders.clear();
    this.sync();
  }

  private get wanted(): boolean {
    return this.holders.size > 0 && !this.visibility.hidden;
  }

  private sync(): void {
    if (!this.api) return;
    if (this.wanted && !this.sentinel && !this.pending) {
      this.pending = true;
      this.api.request('screen').then(
        (sentinel) => {
          this.pending = false;
          this.sentinel = sentinel;
          sentinel.addEventListener('release', () => {
            if (this.sentinel === sentinel) this.sentinel = null;
          });
          // Things may have changed while the request was in flight.
          this.sync();
        },
        () => {
          // NotAllowedError (battery saver, no permission policy): live without it.
          this.pending = false;
        },
      );
    } else if (!this.wanted && this.sentinel) {
      const sentinel = this.sentinel;
      this.sentinel = null;
      sentinel.release().catch(() => undefined);
    }
  }
}

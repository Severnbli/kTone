// Page and audio lifecycle helpers shared by the mic engine and the drone.
// Browser APIs are wrapped behind small interfaces so the rules can be unit
// tested with fakes. The rules themselves are documented in docs/decisions.md.

/** How long the page may stay hidden before the mic and the drone are stopped. */
export const BACKGROUND_STOP_MS = 60_000;

/** `AudioContext.resume()` can hang outside a user gesture on iOS. */
export const RESUME_TIMEOUT_MS = 1_000;

export interface PageVisibility {
  readonly hidden: boolean;
  /** Calls `listener` after every visibility change. Returns an unsubscribe. */
  subscribe(listener: () => void): () => void;
}

/** `document.visibilityState`, or an always-visible page where there is no document. */
export function documentVisibility(
  doc: Document | undefined = globalThis.document,
): PageVisibility {
  if (!doc) return { hidden: false, subscribe: () => () => undefined };
  return {
    get hidden() {
      return doc.visibilityState === 'hidden';
    },
    subscribe(listener) {
      doc.addEventListener('visibilitychange', listener);
      return () => doc.removeEventListener('visibilitychange', listener);
    },
  };
}

export interface VisibilityWatch {
  /** Runs once the page has been hidden for `hiddenTimeoutMs` without coming back. */
  onHiddenTimeout: () => void;
  /** Runs every time the page becomes visible again. */
  onVisible: () => void;
  hiddenTimeoutMs?: number;
}

/** Applies the background rules. Returns a function that stops watching. */
export function watchVisibility(visibility: PageVisibility, watch: VisibilityWatch): () => void {
  const ms = watch.hiddenTimeoutMs ?? BACKGROUND_STOP_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const update = () => {
    if (visibility.hidden) {
      timer ??= setTimeout(() => {
        timer = null;
        watch.onHiddenTimeout();
      }, ms);
    } else {
      clear();
      watch.onVisible();
    }
  };
  if (visibility.hidden) update();
  const unsubscribe = visibility.subscribe(update);
  return () => {
    clear();
    unsubscribe();
  };
}

/** The subset of AudioContext the lifecycle code needs. */
export interface ContextLike {
  readonly state: string;
  resume(): Promise<void>;
}

/**
 * Tries to resume `ctx` and reports whether it is running. Never throws and
 * never hangs longer than `timeoutMs` (iOS may leave the promise pending
 * outside a user gesture).
 */
export async function resumeContext(
  ctx: ContextLike,
  timeoutMs = RESUME_TIMEOUT_MS,
): Promise<boolean> {
  if (ctx.state === 'running') return true;
  if (ctx.state === 'closed') return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      ctx.resume(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } catch {
    // Not allowed without a gesture, or the system still holds the audio.
  } finally {
    clearTimeout(timer);
  }
  return ctx.state === 'running';
}

/** `suspended` and Safari's `interrupted` both mean "no audio is flowing for now". */
export function isContextPaused(state: string): boolean {
  return state === 'suspended' || state === 'interrupted';
}

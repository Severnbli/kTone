// Microphone capture: getUserMedia (all browser voice processing off) ->
// MediaStreamSource -> AudioWorklet (`public/pitch-worklet.js`) -> blocks of
// samples posted to the main thread. The session reports interruptions
// (track ended or muted, context suspended or interrupted) via `onStateChange`.

import type { AudioLatency } from './debugStats';
import { isContextPaused, resumeContext } from './lifecycle';

export type MicErrorCode = 'denied' | 'notFound' | 'unsupported' | 'error';

export class MicError extends Error {
  constructor(
    readonly code: MicErrorCode,
    cause?: unknown,
  ) {
    super(`microphone: ${code}`, { cause });
  }
}

/**
 * - `running`: samples are flowing.
 * - `suspended`: the system paused audio (phone call, Siri, background, muted
 *   track); `resume()` may bring it back.
 * - `ended`: the track is gone (device unplugged, permission revoked, mic taken
 *   by another app). The session is dead; start a new one.
 */
export type MicState = 'running' | 'suspended' | 'ended';

export interface MicSession {
  readonly sampleRate: number;
  readonly state: MicState;
  /** Tries to resume a suspended session. Resolves to true when running again. */
  resume(): Promise<boolean>;
  /** What the AudioContext reports about its latency (for the `?debug` overlay). */
  latency?(): AudioLatency;
  stop(): Promise<void>;
}

export interface MicOptions {
  /** Samples per block posted by the worklet. */
  blockSize?: number;
  /** Called when the session state changes (not called for `stop()`). */
  onStateChange?: (state: MicState) => void;
  /**
   * `deviceId` of the audio input to open; empty or missing means the system
   * default. A device that is gone falls back to the default.
   */
  deviceId?: string;
}

export type StartMic = (
  onBlock: (block: Float32Array) => void,
  options?: MicOptions,
) => Promise<MicSession>;

/** The subset of MediaStreamTrack / AudioContext the state watcher needs. */
export interface TrackLike extends EventTarget {
  readonly readyState: string;
  readonly muted: boolean;
}
export interface WatchedContextLike extends EventTarget {
  readonly state: string;
}

export function micState(track: TrackLike, ctx: WatchedContextLike): MicState {
  if (track.readyState === 'ended') return 'ended';
  if (track.muted || isContextPaused(ctx.state) || ctx.state === 'closed') return 'suspended';
  return 'running';
}

/**
 * Listens to track `ended`/`mute`/`unmute` and context `statechange` and calls
 * `onChange` whenever the derived MicState changes. Returns a detach function.
 */
export function watchMicState(
  track: TrackLike,
  ctx: WatchedContextLike,
  onChange: (state: MicState) => void,
): () => void {
  let last = micState(track, ctx);
  const update = () => {
    const next = micState(track, ctx);
    if (next === last || last === 'ended') return;
    last = next;
    onChange(next);
  };
  const trackEvents = ['ended', 'mute', 'unmute'];
  trackEvents.forEach((e) => track.addEventListener(e, update));
  ctx.addEventListener('statechange', update);
  return () => {
    trackEvents.forEach((e) => track.removeEventListener(e, update));
    ctx.removeEventListener('statechange', update);
  };
}

export const WORKLET_URL = `${import.meta.env.BASE_URL}pitch-worklet.js`;

function errorName(err: unknown): string {
  return err && typeof err === 'object' ? String((err as Error).name ?? '') : '';
}

export function classifyMicError(err: unknown): MicErrorCode {
  const name = errorName(err);
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError')
    return 'denied';
  if (
    name === 'NotFoundError' ||
    name === 'DevicesNotFoundError' ||
    name === 'OverconstrainedError'
  )
    return 'notFound';
  return 'error';
}

/** Raw input only: every browser voice processing step off, mono, optionally an exact device. */
export function micConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    },
    video: false,
  };
}

const MISSING_DEVICE = new Set(['OverconstrainedError', 'NotFoundError', 'DevicesNotFoundError']);

/**
 * Opens the microphone stream. When a specific device was asked for and it is
 * gone (stale id: `OverconstrainedError` / `NotFoundError`), retries once with
 * the system default. Throws MicError.
 */
export async function openMicStream(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  deviceId?: string,
): Promise<MediaStream> {
  try {
    return await getUserMedia(micConstraints(deviceId));
  } catch (err) {
    if (!deviceId || !MISSING_DEVICE.has(errorName(err))) {
      throw new MicError(classifyMicError(err), err);
    }
  }
  try {
    return await getUserMedia(micConstraints());
  } catch (err) {
    throw new MicError(classifyMicError(err), err);
  }
}

/**
 * Must be called from a user gesture (creates/resumes the AudioContext).
 * `onBlock` receives a block that is only valid during the call.
 */
/** `baseLatency` / `outputLatency` of a context; null where the browser lacks them. */
export function contextLatency(ctx: {
  readonly baseLatency?: number;
  readonly outputLatency?: number;
}): AudioLatency {
  const finite = (v: number | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  return { baseLatency: finite(ctx.baseLatency), outputLatency: finite(ctx.outputLatency) };
}

export const startMic: StartMic = async (onBlock, options = {}) => {
  const { blockSize = 512, onStateChange, deviceId } = options;
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioContext === 'undefined' ||
    typeof AudioWorkletNode === 'undefined'
  ) {
    throw new MicError('unsupported');
  }
  const md = navigator.mediaDevices;
  const stream = await openMicStream((c) => md.getUserMedia(c), deviceId);

  const ctx = new AudioContext({ latencyHint: 'interactive' });
  try {
    await ctx.resume();
    await ctx.audioWorklet.addModule(WORKLET_URL);
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'ktone-capture', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: { blockSize },
    });
    node.port.onmessage = (event: MessageEvent<Float32Array>) => {
      const block = event.data;
      onBlock(block);
      // Hand the buffer back to the worklet's pool.
      node.port.postMessage(block, [block.buffer]);
    };
    // Keep the graph pulled without making any sound.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(node).connect(mute).connect(ctx.destination);

    const [track] = stream.getAudioTracks();
    const detach = watchMicState(track, ctx, (state) => onStateChange?.(state));

    return {
      sampleRate: ctx.sampleRate,
      latency: () => contextLatency(ctx),
      get state() {
        return micState(track, ctx);
      },
      async resume() {
        if (track.readyState === 'ended') return false;
        return (await resumeContext(ctx)) && micState(track, ctx) === 'running';
      },
      async stop() {
        detach();
        node.port.onmessage = null;
        source.disconnect();
        node.disconnect();
        mute.disconnect();
        stream.getTracks().forEach((t) => t.stop());
        await ctx.close().catch(() => undefined);
      },
    };
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => undefined);
    throw new MicError('error', err);
  }
};

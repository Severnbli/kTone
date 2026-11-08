// Microphone capture: getUserMedia (all browser voice processing off) ->
// MediaStreamSource -> AudioWorklet (`public/pitch-worklet.js`) -> blocks of
// samples posted to the main thread.

export type MicErrorCode = 'denied' | 'notFound' | 'unsupported' | 'error';

export class MicError extends Error {
  constructor(
    readonly code: MicErrorCode,
    cause?: unknown,
  ) {
    super(`microphone: ${code}`, { cause });
  }
}

export interface MicSession {
  readonly sampleRate: number;
  stop(): Promise<void>;
}

export const WORKLET_URL = `${import.meta.env.BASE_URL}pitch-worklet.js`;

export function classifyMicError(err: unknown): MicErrorCode {
  const name = err instanceof Error || (err && typeof err === 'object') ? (err as Error).name : '';
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

/**
 * Must be called from a user gesture (creates/resumes the AudioContext).
 * `onBlock` receives a block that is only valid during the call.
 */
export async function startMic(
  onBlock: (block: Float32Array) => void,
  blockSize = 512,
): Promise<MicSession> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia ||
    typeof AudioContext === 'undefined' ||
    typeof AudioWorkletNode === 'undefined'
  ) {
    throw new MicError('unsupported');
  }
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });
  } catch (err) {
    throw new MicError(classifyMicError(err), err);
  }

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

    return {
      sampleRate: ctx.sampleRate,
      async stop() {
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
}

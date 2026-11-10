import { describe, expect, it, vi } from 'vitest';
import { onMicPermission } from './devices';
import { MicError, micConstraints, micState, openMicStream, watchMicState } from './mic';

function fakeTrack() {
  const t = new EventTarget() as EventTarget & { readyState: string; muted: boolean };
  t.readyState = 'live';
  t.muted = false;
  return t;
}

function fakeCtx() {
  const c = new EventTarget() as EventTarget & { state: string };
  c.state = 'running';
  return c;
}

describe('micState', () => {
  it('derives the session state from the track and the context', () => {
    const track = fakeTrack();
    const ctx = fakeCtx();
    expect(micState(track, ctx)).toBe('running');
    ctx.state = 'interrupted';
    expect(micState(track, ctx)).toBe('suspended');
    ctx.state = 'running';
    track.muted = true;
    expect(micState(track, ctx)).toBe('suspended');
    track.readyState = 'ended';
    expect(micState(track, ctx)).toBe('ended');
  });
});

describe('watchMicState', () => {
  it('reports suspend, resume and end once each', () => {
    const track = fakeTrack();
    const ctx = fakeCtx();
    const onChange = vi.fn();
    const detach = watchMicState(track, ctx, onChange);

    ctx.state = 'suspended';
    ctx.dispatchEvent(new Event('statechange'));
    ctx.dispatchEvent(new Event('statechange'));
    ctx.state = 'running';
    ctx.dispatchEvent(new Event('statechange'));
    track.muted = true;
    track.dispatchEvent(new Event('mute'));
    track.muted = false;
    track.dispatchEvent(new Event('unmute'));
    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
    // Nothing after `ended`.
    ctx.state = 'closed';
    ctx.dispatchEvent(new Event('statechange'));

    expect(onChange.mock.calls.map((c) => c[0])).toEqual([
      'suspended',
      'running',
      'suspended',
      'running',
      'ended',
    ]);
    detach();
  });

  it('stops listening after detach', () => {
    const track = fakeTrack();
    const ctx = fakeCtx();
    const onChange = vi.fn();
    watchMicState(track, ctx, onChange)();
    track.readyState = 'ended';
    track.dispatchEvent(new Event('ended'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('micConstraints', () => {
  const RAW = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };

  it('asks for the raw default input', () => {
    expect(micConstraints()).toEqual({ audio: RAW, video: false });
    expect(micConstraints('')).toEqual({ audio: RAW, video: false });
  });

  it('pins an exact device and keeps processing off', () => {
    expect(micConstraints('usb-1')).toEqual({
      audio: { ...RAW, deviceId: { exact: 'usb-1' } },
      video: false,
    });
  });
});

describe('openMicStream', () => {
  const stream = {} as MediaStream;
  const exactId = (c: MediaStreamConstraints) =>
    ((c.audio as MediaTrackConstraints).deviceId as ConstrainDOMStringParameters | undefined)
      ?.exact;

  it('opens the requested device', async () => {
    const gum = vi.fn<(c: MediaStreamConstraints) => Promise<MediaStream>>(async () => stream);
    await expect(openMicStream(gum, 'usb-1')).resolves.toBe(stream);
    expect(gum).toHaveBeenCalledTimes(1);
    expect(exactId(gum.mock.calls[0][0])).toBe('usb-1');
  });

  it.each(['OverconstrainedError', 'NotFoundError'])(
    'falls back to the default device on %s',
    async (name) => {
      const gum = vi.fn(async (c: MediaStreamConstraints) => {
        if (exactId(c)) throw Object.assign(new Error('gone'), { name, constraint: 'deviceId' });
        return stream;
      });
      await expect(openMicStream(gum, 'stale')).resolves.toBe(stream);
      expect(gum).toHaveBeenCalledTimes(2);
      expect(exactId(gum.mock.calls[1][0])).toBeUndefined();
    },
  );

  it('does not retry a denied permission', async () => {
    const gum = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    await expect(openMicStream(gum, 'usb-1')).rejects.toMatchObject({ code: 'denied' });
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it('reports a missing default device as notFound', async () => {
    const gum = vi.fn(async () => {
      throw new DOMException('none', 'NotFoundError');
    });
    await expect(openMicStream(gum)).rejects.toMatchObject({ code: 'notFound' });
    await expect(openMicStream(gum, 'stale')).rejects.toBeInstanceOf(MicError);
    expect(gum).toHaveBeenCalledTimes(3);
  });

  it('announces the permission after a successful open, not after a failure', async () => {
    const granted = vi.fn();
    const off = onMicPermission(granted);
    const denied = vi.fn(async () => {
      throw new DOMException('no', 'NotAllowedError');
    });
    await expect(openMicStream(denied)).rejects.toBeInstanceOf(MicError);
    expect(granted).not.toHaveBeenCalled();
    await openMicStream(async () => stream);
    expect(granted).toHaveBeenCalledTimes(1);
    // The default-device fallback counts too.
    await openMicStream(async (c) => {
      if (exactId(c)) throw Object.assign(new Error('gone'), { name: 'NotFoundError' });
      return stream;
    }, 'stale');
    expect(granted).toHaveBeenCalledTimes(2);
    off();
    await openMicStream(async () => stream);
    expect(granted).toHaveBeenCalledTimes(2);
  });
});

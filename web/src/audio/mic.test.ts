import { describe, expect, it, vi } from 'vitest';
import { micState, watchMicState } from './mic';

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

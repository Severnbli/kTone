import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeVisibility } from '../test/fakes';
import { documentVisibility, isContextPaused, resumeContext, watchVisibility } from './lifecycle';

afterEach(() => {
  vi.useRealTimers();
});

describe('documentVisibility', () => {
  it('follows document.visibilityState and visibilitychange', () => {
    let state: DocumentVisibilityState = 'visible';
    const doc = new EventTarget() as Document;
    Object.defineProperty(doc, 'visibilityState', { get: () => state });
    const v = documentVisibility(doc);
    const listener = vi.fn();
    const off = v.subscribe(listener);
    expect(v.hidden).toBe(false);
    state = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(v.hidden).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('watchVisibility', () => {
  it('fires the timeout only after staying hidden long enough', () => {
    vi.useFakeTimers();
    const v = fakeVisibility();
    const onHiddenTimeout = vi.fn();
    const onVisible = vi.fn();
    const stop = watchVisibility(v, { hiddenTimeoutMs: 100, onHiddenTimeout, onVisible });
    v.set(true);
    vi.advanceTimersByTime(50);
    v.set(false);
    expect(onVisible).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200);
    expect(onHiddenTimeout).not.toHaveBeenCalled();
    v.set(true);
    vi.advanceTimersByTime(100);
    expect(onHiddenTimeout).toHaveBeenCalledTimes(1);
    stop();
    expect(v.listeners).toBe(0);
  });

  it('starts the timer when already hidden and clears it on stop', () => {
    vi.useFakeTimers();
    const onHiddenTimeout = vi.fn();
    const stop = watchVisibility(fakeVisibility(true), {
      hiddenTimeoutMs: 100,
      onHiddenTimeout,
      onVisible: () => undefined,
    });
    stop();
    vi.advanceTimersByTime(500);
    expect(onHiddenTimeout).not.toHaveBeenCalled();
  });
});

describe('resumeContext', () => {
  it('resolves true when the context resumes', async () => {
    const ctx = {
      state: 'suspended',
      resume: async () => {
        ctx.state = 'running';
      },
    };
    expect(await resumeContext(ctx)).toBe(true);
  });

  it('resolves false when resume throws', async () => {
    const ctx = {
      state: 'interrupted',
      resume: async () => {
        throw new DOMException('no', 'InvalidStateError');
      },
    };
    expect(await resumeContext(ctx)).toBe(false);
  });

  it('gives up on a resume() that never settles (iOS without a gesture)', async () => {
    vi.useFakeTimers();
    const ctx = { state: 'interrupted', resume: () => new Promise<void>(() => undefined) };
    const result = resumeContext(ctx, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(false);
  });

  it('does not touch closed or running contexts', async () => {
    const resume = vi.fn(async () => undefined);
    expect(await resumeContext({ state: 'closed', resume })).toBe(false);
    expect(await resumeContext({ state: 'running', resume })).toBe(true);
    expect(resume).not.toHaveBeenCalled();
  });

  it('treats suspended and interrupted as paused', () => {
    expect(isContextPaused('suspended')).toBe(true);
    expect(isContextPaused('interrupted')).toBe(true);
    expect(isContextPaused('running')).toBe(false);
  });
});

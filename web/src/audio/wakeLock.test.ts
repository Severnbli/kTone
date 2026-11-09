import { describe, expect, it } from 'vitest';
import { fakeVisibility, fakeWakeLock, flush } from '../test/fakes';
import { browserWakeLock, ScreenWakeLock } from './wakeLock';

describe('ScreenWakeLock', () => {
  it('holds one lock while any holder wants it', async () => {
    const { api, held } = fakeWakeLock();
    const lock = new ScreenWakeLock(api, fakeVisibility());
    lock.set('mic', true);
    lock.set('drone', true);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(held()).toBe(1);
    expect(lock.active).toBe(true);
    lock.set('mic', false);
    await flush();
    expect(held()).toBe(1);
    lock.set('drone', false);
    await flush();
    expect(held()).toBe(0);
    expect(lock.active).toBe(false);
  });

  it('re-acquires after the browser drops the lock on hide', async () => {
    const { api, sentinels, held } = fakeWakeLock();
    const visibility = fakeVisibility();
    const lock = new ScreenWakeLock(api, visibility);
    lock.set('mic', true);
    await flush();
    sentinels[0].systemRelease();
    visibility.set(true);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(1);
    visibility.set(false);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(2);
    expect(held()).toBe(1);
  });

  it('releases a lock that arrives after it is no longer wanted', async () => {
    const { api, held } = fakeWakeLock();
    const lock = new ScreenWakeLock(api, fakeVisibility());
    lock.set('mic', true);
    lock.set('mic', false);
    await flush();
    expect(api.request).toHaveBeenCalledTimes(1);
    expect(held()).toBe(0);
  });

  it('does not request while hidden', async () => {
    const { api } = fakeWakeLock();
    const lock = new ScreenWakeLock(api, fakeVisibility(true));
    lock.set('mic', true);
    await flush();
    expect(api.request).not.toHaveBeenCalled();
  });

  it('swallows refused requests and works without the API', async () => {
    const { api } = fakeWakeLock();
    api.refuse(true);
    const lock = new ScreenWakeLock(api, fakeVisibility());
    lock.set('mic', true);
    await flush();
    expect(lock.active).toBe(false);
    const none = new ScreenWakeLock(null, fakeVisibility());
    expect(() => none.set('mic', true)).not.toThrow();
    none.dispose();
  });

  it('releases everything on dispose and stops listening', async () => {
    const { api, held } = fakeWakeLock();
    const visibility = fakeVisibility();
    const lock = new ScreenWakeLock(api, visibility);
    lock.set('mic', true);
    await flush();
    lock.dispose();
    await flush();
    expect(held()).toBe(0);
    expect(visibility.listeners).toBe(0);
  });

  it('browserWakeLock is null in jsdom', () => {
    expect(browserWakeLock()).toBeNull();
  });
});

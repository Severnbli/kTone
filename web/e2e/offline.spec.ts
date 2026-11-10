import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// The other specs block service workers; this one needs it.
test.use({ launchOptions: fakeMicLaunchOptions('a440.wav'), serviceWorkers: 'allow' });

test('works offline after the first visit', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'kTone' })).toBeVisible();

  // `ready` resolves once the worker is active, i.e. after the precache filled.
  const version = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.active?.scriptURL ?? null;
  });
  expect(version).toMatch(/\/sw\.js$/);

  // Everything the page needs is precached on the very first visit, before
  // the worker controls the page: the entry bundles, the worklet and the WASM.
  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      urls.push(...(await cache.keys()).map((r) => r.url));
    }
    return urls;
  });
  const entries = await page.evaluate(() =>
    [
      ...Array.from(document.querySelectorAll<HTMLScriptElement>('script[src]'), (s) => s.src),
      ...Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]'),
        (l) => l.href,
      ),
    ].filter((url) => new URL(url).origin === location.origin),
  );
  expect(entries.length).toBeGreaterThan(0);
  for (const url of entries) expect(cached).toContain(url);
  expect(cached.some((url) => url.endsWith('/pitch-worklet.js'))).toBe(true);
  expect(cached.some((url) => url.endsWith('.wasm'))).toBe(true);

  // Make sure nothing can come from the HTTP cache.
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await context.setOffline(true);
  const failed: string[] = [];
  page.on('requestfailed', (request) => failed.push(request.url()));
  await page.reload();

  await expect(page.getByRole('heading', { name: 'kTone' })).toBeVisible();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

  // The worklet, the lazy WASM chunk and the .wasm file all come from the cache.
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(page.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'green');
  // Nothing fell back to the network (the engine would silently use the TS mock).
  expect(failed).toEqual([]);

  await context.setOffline(false);
});

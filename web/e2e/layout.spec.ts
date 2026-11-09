import { expect, test, type Page } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

/** Everything on one screen: no page scroll either way, the bottom bar in view. */
async function expectOneScreen(page: Page) {
  const size = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  expect(size.scrollW).toBeLessThanOrEqual(size.w);
  expect(size.scrollH).toBeLessThanOrEqual(size.h);
  for (const id of ['start-stop', 'drone-open', 'key-badge', 'cents-gauge', 'pitch-curve']) {
    await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 });
  }
  // The stage itself does not need to scroll either.
  const stageOverflow = await page
    .locator('.stage')
    .evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(stageOverflow).toBeLessThanOrEqual(0);
}

for (const [w, h] of [
  [390, 844],
  [360, 640],
  [1280, 800],
] as const) {
  test(`the main screen fits ${w}×${h} without scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await page.goto('/');
    await expectOneScreen(page);
    await page.getByTestId('start-stop').click();
    await expect(page.getByTestId('note-name')).toHaveText('ля');
    await expectOneScreen(page);
  });
}

test('touch targets in the header and the bottom bar are at least 44 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  const targets = [
    page.getByTestId('key-badge'),
    page.getByTestId('clef-chip'),
    page.getByRole('button', { name: 'Настройки' }),
    page.getByTestId('drone-open'),
    page.getByTestId('start-stop'),
  ];
  for (const target of targets) {
    const box = (await target.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

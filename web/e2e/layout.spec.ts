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

test('settings end with the source link and do not overflow at 360×640', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  // Phones keep the header clean: the source link lives in the settings only.
  await expect(page.getByTestId('header-source-link')).toBeHidden();

  await page.getByRole('button', { name: 'Настройки' }).click();
  const link = page.getByRole('link', { name: /Исходный код на GitHub/ });
  await link.scrollIntoViewIfNeeded();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://github.com/Severnbli/kTone');
  await expect(link).toHaveAttribute('target', '_blank');
  const box = (await link.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(page.getByTestId('app-version')).toHaveText(/^Версия \d+\.\d+\.\d+ · \S+$/);

  const size = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    scrollH: document.documentElement.scrollHeight,
    w: window.innerWidth,
    h: window.innerHeight,
  }));
  expect(size.scrollW).toBeLessThanOrEqual(size.w);
  expect(size.scrollH).toBeLessThanOrEqual(size.h);
  const sheetOverflowX = await page
    .getByTestId('settings-panel')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(sheetOverflowX).toBeLessThanOrEqual(0);
});

test('desktop header has a quiet source link next to the settings', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');
  const link = page.getByTestId('header-source-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://github.com/Severnbli/kTone');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(link).toHaveAttribute('title', 'Исходный код kTone на GitHub');
  const box = (await link.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
});

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

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
  for (const id of [
    'start-stop',
    'drone-open',
    'target-open',
    'key-badge',
    'cents-gauge',
    'pitch-curve',
  ]) {
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

test('the target sheet fits 360×640 and the screen still fits with a target on', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await page.getByTestId('target-open').click();
  const sheet = page.getByTestId('target-sheet');
  await sheet.getByRole('switch', { name: 'Петь к целевой ноте' }).check();
  await sheet.getByLabel('VII · си').check();
  await expect(sheet).toBeInViewport({ ratio: 1 });
  const fit = await sheet.evaluate((el) => {
    const body = el.querySelector('.sheet-body')!;
    return {
      scrollW: document.documentElement.scrollWidth - window.innerWidth,
      sheetScroll: el.scrollHeight - el.clientHeight,
      bodyW: body.scrollWidth - body.clientWidth,
    };
  });
  expect(fit.scrollW).toBeLessThanOrEqual(0);
  expect(fit.sheetScroll).toBeLessThanOrEqual(0);
  expect(fit.bodyW).toBeLessThanOrEqual(0);
  for (const control of [
    sheet.getByRole('button', { name: 'Октава ниже' }),
    sheet.getByRole('button', { name: 'Октава выше' }),
    sheet.locator('.degree-cell').first(),
  ]) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('note-target')).toBeVisible();
  await expectOneScreen(page);
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
    page.getByTestId('target-open'),
  ];
  for (const target of targets) {
    const box = (await target.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
});

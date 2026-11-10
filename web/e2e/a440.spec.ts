import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

test('steady A4 shows «ля» in the green zone', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'kTone' })).toBeVisible();
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');

  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(page.getByTestId('note-octave')).toHaveText('первой октавы');
  await expect(page.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'green');
  await expect(page.getByTestId('note-hz')).toHaveText(/^4(39|40)\.\d$/);
  await expect(page.getByTestId('note-degree')).toContainText('VI');
  await expect(page.getByTestId('note-head')).toBeVisible();

  // Letter names with scientific octave.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByLabel(/C-D-E/).check();
  await expect(page.getByTestId('note-name')).toHaveText('A4');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Начать');
});

test('layout fits a 360 px wide phone', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId('start-stop')).toBeVisible();
});

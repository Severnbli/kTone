import { expect, test, type Page } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

async function setField(page: Page, label: string, value: string) {
  const field = page.getByLabel(label);
  // Committed as typed; Tab keeps the focus in the sheet for Escape.
  await field.fill(value);
  await field.press('Tab');
}

test('with A4 = 442 Hz the same 440 Hz reads about −8 cents', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  const gauge = page.getByTestId('cents-gauge');
  const readout = page.getByTestId('gauge-readout');
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(readout).toHaveText(/^(0|[+-]1)$/);
  await expect(gauge).toHaveAttribute('data-zone', 'green');

  // Changed while listening: the analyzer is reconfigured on the fly.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await setField(page, 'Ля первой октавы (A4), Гц', '442');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // 1200 · log2(440 / 442) = −7.85 cents: still ля, within the ±10 green zone.
  await expect(readout).toHaveText(/^-[78]$/);
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(gauge).toHaveAttribute('data-zone', 'green');
  await expect(gauge).toHaveAttribute('data-dir', 'in');

  // With a ±5 cent green zone the same reading is yellow, on the flat side.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await setField(page, 'Зелёная ±', '5');
  await page.keyboard.press('Escape');
  await expect(gauge).toHaveAttribute('data-zone', 'yellow');
  await expect(gauge).toHaveAttribute('data-dir', 'flat');
  await expect(readout).toHaveText(/^-[78]$/);
});

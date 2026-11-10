import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('g1.wav') });

test('low range mode shows G1, which the normal range does not', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');
  // Normal range: G1 is under the floor and not shown, nor is its octave G2.
  await page.waitForTimeout(1500);
  await expect(page.getByTestId('note-name')).not.toHaveText('соль');

  // Switched on while listening: the session restarts with the long frame.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('switch', { name: 'Низкий диапазон' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByTestId('note-name')).toHaveText('соль');
  await expect(page.getByTestId('note-octave')).toHaveText('контроктавы');

  // Bass clef: G1 hangs under the staff on ledger lines (bottom line G2 = step 0).
  await page.getByTestId('clef-chip').click();
  await page.getByRole('button', { name: 'басовый', exact: true }).click();
  await expect(page.getByTestId('staff-note')).toHaveAttribute('data-step', '-7');

  // Persisted across a reload.
  await page.reload();
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('соль');
});

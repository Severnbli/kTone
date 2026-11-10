import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// 1 s of A4, then 5 s of a quiet room.
test.use({ launchOptions: fakeMicLaunchOptions('a440-then-silence.wav') });

test('after the note stops it stays dimmed and the gauge goes neutral', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  const display = page.getByTestId('note-display');
  const gauge = page.getByTestId('cents-gauge');

  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(display).not.toHaveClass(/inactive/);
  await expect(gauge).toHaveAttribute('data-zone', 'green');

  // The singer stops: the last note stays on screen, dimmed.
  await expect(display).toHaveClass(/inactive/);
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(page.getByTestId('staff-note')).toHaveClass(/inactive/);
  await expect(gauge).toHaveAttribute('data-zone', 'none');
  await expect(page.getByTestId('gauge-readout')).toHaveText('–');
  await expect(page.getByTestId('note-hz')).toHaveText('–');
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');
});

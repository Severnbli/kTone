import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// A4 at −55 dBFS RMS: audible to the meter, below the analyzer gate.
test.use({ launchOptions: fakeMicLaunchOptions('a440-quiet.wav') });

test('a quiet singer gets the "too quiet" hint', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');

  const meter = page.getByTestId('level-meter');
  await expect(meter).toHaveAttribute('data-state', 'low');
  const level = Number(await meter.getAttribute('data-level'));
  expect(level).toBeGreaterThan(-60);
  expect(level).toBeLessThan(-46);

  await expect(page.getByTestId('level-hint')).toHaveText(
    'Слишком тихо – подойдите ближе к микрофону или пойте громче',
  );
  await expect(page.getByTestId('note-name')).toHaveText('–');

  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('level-hint')).toHaveCount(0);
});

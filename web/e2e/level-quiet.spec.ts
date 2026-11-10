import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// A quiet room (−68 dBFS noise) with A4 at −60 dBFS: the gate calibrates to
// about −57 dBFS, so the singer is heard by the meter but stays below it.
test.use({ launchOptions: fakeMicLaunchOptions('a440-quiet.wav') });

test('a quiet singer gets the "too quiet" hint against a calibrated gate', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');

  const meter = page.getByTestId('level-meter');
  // The gate drops from the default −46 dBFS towards the room noise.
  await expect
    .poll(async () => Number(await meter.getAttribute('data-gate')), { timeout: 5000 })
    .toBeLessThan(-54);
  const floor = Number(await meter.getAttribute('data-floor'));
  expect(floor).toBeGreaterThan(-72);
  expect(floor).toBeLessThan(-64);
  await expect(page.getByTestId('level-floor')).toBeVisible();

  await expect(page.getByTestId('level-hint')).toHaveText(
    'Слишком тихо – подойдите ближе к микрофону или пойте громче',
    { timeout: 10_000 },
  );
  // Below the gate: never shown as a note.
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('note-name')).toHaveText('–');
    await page.waitForTimeout(300);
  }

  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('level-hint')).toHaveCount(0);
});

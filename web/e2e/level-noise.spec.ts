import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// A noisy room: pink-ish noise with 50/100 Hz hum at −40 dBFS, no voice.
test.use({ launchOptions: fakeMicLaunchOptions('room-noise.wav') });

test('room noise raises the gate, shows no note and gets the noisy-room hint', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');

  const meter = page.getByTestId('level-meter');
  const gate = page.getByTestId('level-gate');
  await expect(gate).toBeVisible();
  const left = () => gate.evaluate((el) => parseFloat(el.style.left));
  // The default gate is −46 dBFS (34 % of the −70..0 scale); it moves up to
  // the −34 dBFS maximum (about 51 %).
  await expect.poll(left, { timeout: 5000 }).toBeGreaterThan(48);
  expect(Number(await meter.getAttribute('data-gate'))).toBeCloseTo(-34, 0);

  await expect(page.getByTestId('level-hint')).toHaveText(
    'Вокруг шумно – распознавание может пропускать тихие ноты',
    { timeout: 10_000 },
  );
  for (let i = 0; i < 10; i++) {
    await expect(page.getByTestId('note-name')).toHaveText('–');
    await page.waitForTimeout(300);
  }
});

import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

test('?debug shows analysis time, drops and audio latency', async ({ page }) => {
  const lines: string[] = [];
  page.on('console', (msg) => {
    if (msg.text().startsWith('kTone latency:')) lines.push(msg.text());
  });
  await page.goto('/?debug');
  const overlay = page.getByTestId('debug-overlay');
  await expect(overlay).toBeVisible();
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(overlay).toContainText(/analysis \d+\.\d\d \/ \d+\.\d\d ms/);
  await expect(overlay).toContainText(/dropped \d+ \/ [1-9]\d* frames/);
  await expect(overlay).toContainText(/base (\d+\.\d|n\/a) ms/);
  await expect.poll(() => lines.length, { timeout: 8000 }).toBeGreaterThan(0);
  console.log(lines.at(-1));
});

test('no overlay without ?debug', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('start-stop')).toBeVisible();
  await expect(page.getByTestId('debug-overlay')).toHaveCount(0);
});

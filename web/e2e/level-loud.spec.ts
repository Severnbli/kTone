import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// A4 at full scale: every period touches 0 dBFS.
test.use({ launchOptions: fakeMicLaunchOptions('a440-loud.wav') });

test('a clipping input gets the "too loud" hint', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('level-meter')).toHaveAttribute('data-state', 'clip');
  await expect(page.getByTestId('level-hint')).toHaveAttribute('data-hint', 'loud');
  await expect(page.getByTestId('level-hint')).toContainText('Слишком громко');
});

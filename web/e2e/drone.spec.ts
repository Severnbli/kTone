import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// The mic only hears the default drone (C3) leaking from the speakers.
test.use({ launchOptions: fakeMicLaunchOptions('drone-c3.wav') });

test('the drone filter hides the leaked drone and hints at headphones', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('drone-open').click();
  await page.getByTestId('drone-toggle').click();
  await expect(page.getByTestId('drone-toggle')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');

  await expect(page.getByTestId('drone-leak-hint')).toHaveText(/Микрофон слышит бурдон/);
  await page.waitForTimeout(1000);
  await expect(page.getByTestId('note-name')).toHaveText('–');

  // With the filter off the drone shows up as a sung C3; the hint stays.
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByLabel('Не принимать бурдон за голос').uncheck();
  await expect(page.getByTestId('note-name')).toHaveText('до');
  await expect(page.getByTestId('note-octave')).toHaveText('малой октавы');
  await expect(page.getByTestId('drone-leak-hint')).toBeVisible();
  await page.keyboard.press('Escape');

  // The bottom-bar button says what plays; the sheet turns it off.
  await expect(page.getByTestId('drone-open')).toHaveAccessibleName(
    'Бурдон · до малой октавы, звучит',
  );
  await page.getByTestId('drone-open').click();
  await page.getByTestId('drone-toggle').click();
  await expect(page.getByTestId('drone-leak-hint')).toHaveCount(0);
});

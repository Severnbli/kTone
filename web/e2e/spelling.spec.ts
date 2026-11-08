import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// 466.16 Hz: A♯4 in sharp keys, B♭4 in flat keys.
test.use({ launchOptions: fakeMicLaunchOptions('a466.wav') });

test('key signature drives the spelling of a chromatic pitch', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Настройки' }).click();
  const keySelect = page.getByLabel('Тональность');

  await keySelect.selectOption({ label: 'Ре мажор' });
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля♯');
  await expect(page.getByTestId('note-degree')).toHaveText('вне тональности');
  await expect(page.getByTestId('note-display')).toHaveClass(/out-of-key/);
  await expect(page.getByTestId('note-accidental')).toHaveText('♯');

  await keySelect.selectOption({ label: 'Фа мажор' });
  await expect(page.getByTestId('note-name')).toHaveText('си♭');
  await expect(page.getByTestId('note-degree')).toContainText('IV');
  await expect(page.getByTestId('note-display')).not.toHaveClass(/out-of-key/);
  // B♭ is in the F major signature: no accidental next to the note head.
  await expect(page.getByTestId('signature-accidental')).toHaveCount(1);
  await expect(page.getByTestId('note-accidental')).toHaveCount(0);
});

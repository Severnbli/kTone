import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// 466.16 Hz: A♯4 in sharp keys, B♭4 in flat keys.
test.use({ launchOptions: fakeMicLaunchOptions('a466.wav') });

/** Change the key from the header chip's picker. */
async function pickKey(
  page: import('@playwright/test').Page,
  mode: 'Мажор' | 'Минор',
  name: string,
) {
  await page.getByTestId('key-badge').click();
  const picker = page.getByRole('dialog', { name: 'Тональность' });
  await expect(picker).toBeVisible();
  await picker.getByRole('radio', { name: mode }).check();
  await picker.getByRole('button', { name, exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('key-badge')).toHaveText(name);
}

test('key signature drives the spelling of a chromatic pitch', async ({ page }) => {
  await page.goto('/');
  await pickKey(page, 'Мажор', 'Ре мажор');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля♯');
  await expect(page.getByTestId('note-degree')).toHaveText('вне тональности');
  await expect(page.getByTestId('note-display')).toHaveClass(/out-of-key/);
  await expect(page.getByTestId('note-accidental')).toHaveText('♯');

  // Detection keeps running while the picker is open.
  await pickKey(page, 'Мажор', 'Фа мажор');
  await expect(page.getByTestId('note-name')).toHaveText('си♭');
  await expect(page.getByTestId('note-degree')).toContainText('IV');
  await expect(page.getByTestId('note-display')).not.toHaveClass(/out-of-key/);
  // B♭ is in the F major signature: no accidental next to the note head.
  await expect(page.getByTestId('signature-accidental')).toHaveCount(1);
  await expect(page.getByTestId('note-accidental')).toHaveCount(0);

  // Relative minor of D♭ major: five flats, B♭ is diatonic there too.
  await pickKey(page, 'Минор', 'си-бемоль минор');
  await expect(page.getByTestId('note-name')).toHaveText('си♭');
  await expect(page.getByTestId('note-degree')).toContainText('I');
  await expect(page.getByTestId('signature-accidental')).toHaveCount(5);
});

test('the key picker works from the keyboard', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('key-badge').focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Тональность' });
  // The current key has the focus.
  await expect(picker.getByRole('button', { name: 'До мажор' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('key-badge')).toHaveText('Фа мажор');
  await expect(picker).toHaveCount(0);
  await expect(page.getByTestId('key-badge')).toBeFocused();
});

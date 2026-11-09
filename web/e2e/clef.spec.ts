import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

test('the clef chip moves the same A4 on the staff', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  const staff = page.getByTestId('staff');
  const note = page.getByTestId('staff-note');
  const chip = page.getByTestId('clef-chip');

  // Treble: A4 is the second space (bottom line E4 = step 0).
  await expect(staff).toHaveAttribute('data-clef', 'treble');
  await expect(note).toHaveAttribute('data-step', '3');
  const trebleY = Number(await page.getByTestId('note-head').getAttribute('cy'));

  // Bass: A4 sits above the staff on ledger lines (bottom line G2 = step 0).
  await chip.click();
  await page.getByRole('button', { name: 'басовый', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(chip).toHaveAccessibleName('Ключ: басовый');
  await expect(staff).toHaveAttribute('data-clef', 'bass');
  await expect(note).toHaveAttribute('data-step', '15');
  await expect(page.getByTestId('ledger-line')).toHaveCount(3);
  const bassY = Number(await page.getByTestId('note-head').getAttribute('cy'));
  expect(bassY).toBeLessThan(trebleY);

  // Treble 8vb (male voices): written an octave above the sound, as A5.
  await chip.click();
  await page.getByRole('button', { name: 'скрипичный октавный' }).click();
  await expect(staff).toHaveAttribute('data-clef', 'treble8vb');
  await expect(note).toHaveAttribute('data-step', '10');
  await expect(page.getByTestId('ledger-line')).toHaveCount(1);
  // The sung note itself does not change.
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(page.getByTestId('note-octave')).toHaveText('первой октавы');

  // Persisted across a reload.
  await page.reload();
  await expect(page.getByTestId('staff')).toHaveAttribute('data-clef', 'treble8vb');
});

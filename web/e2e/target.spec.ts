import { expect, test, type Page } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// The mic sings a steady A4 in C major.
test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

/** Picks a degree and steps the octave until the preview names `note`. */
async function setTarget(page: Page, degree: string, note: string) {
  await page.getByTestId('target-open').click();
  const sheet = page.getByTestId('target-sheet');
  const toggle = sheet.getByRole('switch', { name: 'Петь к целевой ноте' });
  if (!(await toggle.isChecked())) await toggle.check();
  await sheet.getByLabel(degree).check();
  const preview = sheet.getByTestId('target-preview');
  for (let i = 0; i < 4 && !(await preview.textContent())?.includes(note); i++) {
    await sheet.getByRole('button', { name: 'Октава ниже' }).click();
  }
  await expect(preview).toHaveText(`Цель: ${note}`);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('sing towards a target note: hit, far away, wrong octave', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  const gauge = page.getByTestId('cents-gauge');
  await expect(gauge).toHaveAttribute('data-target', 'off');

  // VI of C major in the first octave is A4: a hit.
  await setTarget(page, 'VI · ля', 'ля первой октавы');
  await expect(page.getByTestId('target-open')).toHaveAccessibleName('Цель: ля первой октавы');
  await expect(page.getByTestId('target-open-note')).toHaveText('ля¹');
  await expect(gauge).toHaveAttribute('data-target', 'near');
  await expect(gauge).toHaveAttribute('data-zone', 'green');
  const check = await page
    .locator('.gauge-readout')
    .evaluate((el) => getComputedStyle(el, '::before').content);
  expect(check).toBe('"✓"');
  await expect(page.getByTestId('note-target')).toHaveText('Цель: ля первой октавы');
  await expect(page.getByTestId('target-head')).toBeVisible();

  // V is G4: two semitones below the sung A4.
  await setTarget(page, 'V · соль', 'соль первой октавы');
  await expect(gauge).toHaveAttribute('data-target', 'far');
  await expect(page.getByTestId('gauge-message')).toHaveText('ниже на 2 полутона');
  await expect(page.getByTestId('gauge-message')).toBeVisible();
  await expect(page.getByTestId('note-name')).toHaveText('ля');

  // VI in the small octave is A3: the right note an octave too high.
  await setTarget(page, 'VI · ля', 'ля малой октавы');
  await expect(gauge).toHaveAttribute('data-target', 'octave');
  await expect(page.getByTestId('gauge-message')).toHaveText('нота верная, октава выше');

  // Persisted across a reload.
  await page.reload();
  await expect(page.getByTestId('target-open')).toHaveAccessibleName('Цель: ля малой октавы');
});

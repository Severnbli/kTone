import { expect, test, type Page } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

// The mic sings a steady A4 (a pure sine) in C major.
test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

async function openDrone(page: Page) {
  await page.getByTestId('drone-open').click();
  return page.getByTestId('drone-sheet');
}

async function close(page: Page) {
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('drone sheet: on/off, octave, and playing the target', async ({ page }) => {
  await page.goto('/');
  const button = page.getByTestId('drone-open');
  await expect(button).toHaveAccessibleName('Бурдон · до малой октавы, выключен');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');

  // On: the tonic in the default octave.
  let sheet = await openDrone(page);
  const toggle = sheet.getByTestId('drone-toggle');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(toggle).toContainText('Бурдон · до малой октавы');

  // The octave control retunes the playing drone and its labels.
  await sheet.getByRole('radio', { name: 'до первой октавы' }).check();
  await expect(toggle).toContainText('Бурдон · до первой октавы');
  await close(page);
  await expect(button).toHaveAccessibleName('Бурдон · до первой октавы, звучит');
  // The sung A4 is not the drone: still shown.
  await expect(page.getByTestId('note-display')).not.toHaveClass(/inactive/);
  await expect(page.getByTestId('drone-leak-hint')).toHaveCount(0);

  // Target VI in the first octave (A4), and «Бурдон играет цель».
  await page.getByTestId('target-open').click();
  const target = page.getByTestId('target-sheet');
  await target.getByRole('switch', { name: 'Петь к целевой ноте' }).check();
  await target.getByLabel('VI · ля').check();
  const preview = target.getByTestId('target-preview');
  for (let i = 0; i < 4 && !(await preview.textContent())?.includes('первой'); i++) {
    await target.getByRole('button', { name: 'Октава ниже' }).click();
  }
  await expect(preview).toHaveText('Цель: ля первой октавы');
  await close(page);
  sheet = await openDrone(page);
  await sheet.getByRole('switch', { name: 'Бурдон играет цель' }).check();
  await expect(sheet.getByTestId('drone-toggle')).toContainText('Бурдон · ля первой октавы');
  await close(page);
  await expect(button).toHaveAccessibleName('Бурдон · ля первой октавы, звучит');

  // The drone now plays A4, the very pitch of the mic: the filter follows the
  // target, takes the sine for the leaking drone and hides it.
  await expect(page.getByTestId('drone-leak-hint')).toHaveText(/Микрофон слышит бурдон/);
  await expect(page.getByTestId('note-display')).toHaveClass(/inactive/);
  await expect(page.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'none');

  // Off: the hint goes and the A4 is a voice again.
  sheet = await openDrone(page);
  await sheet.getByTestId('drone-toggle').click();
  await expect(sheet.getByTestId('drone-toggle')).toHaveAttribute('aria-pressed', 'false');
  await close(page);
  await expect(button).toHaveAccessibleName('Бурдон · ля первой октавы, выключен');
  await expect(page.getByTestId('drone-leak-hint')).toHaveCount(0);
  await expect(page.getByTestId('note-display')).not.toHaveClass(/inactive/);
  await expect(page.getByTestId('note-name')).toHaveText('ля');
});

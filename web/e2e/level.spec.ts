import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

test('the level meter follows the input and the mic can be switched', async ({ page }) => {
  await page.goto('/');
  const meter = page.getByTestId('level-meter');
  await expect(meter).toHaveAttribute('data-state', 'off');

  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  // The fixture is a 0.5-amplitude sine: about −9 dBFS RMS.
  await expect(meter).toHaveAttribute('data-state', 'ok');
  // Live values (written per frame): poll them, a single frame may lag under load.
  const level = () => meter.getAttribute('data-level').then(Number);
  await expect.poll(level).toBeGreaterThan(-15);
  await expect.poll(level).toBeLessThan(-3);
  const width = () =>
    page.getByTestId('level-fill').evaluate((el) => parseFloat((el as HTMLElement).style.width));
  await expect.poll(width).toBeGreaterThan(70);
  await expect(page.getByTestId('level-hint')).toHaveCount(0);

  // Chromium's fake devices are listed after permission; pick another one.
  await page.getByRole('button', { name: 'Настройки' }).click();
  const select = page.getByLabel('Микрофон', { exact: true });
  await expect(select.locator('option')).not.toHaveCount(1);
  const id = await select.locator('option').nth(1).getAttribute('value');
  await select.selectOption(id!);
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(meter).toHaveAttribute('data-state', 'ok');
  expect(await page.evaluate(() => localStorage.getItem('ktone.settings.v1'))).toContain(id!);

  await page.keyboard.press('Escape');
  await page.getByTestId('start-stop').click();
  await expect(meter).toHaveAttribute('data-state', 'off');
});

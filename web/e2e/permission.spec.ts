import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

test('a denied microphone shows a localized error and Start can be retried', async ({ page }) => {
  // The first request is denied, like a user dismissing the browser prompt;
  // the next one goes through to the fake microphone.
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    const original = md.getUserMedia.bind(md);
    let denied = false;
    md.getUserMedia = (constraints) => {
      if (denied) return original(constraints);
      denied = true;
      return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
    };
  });
  await page.goto('/');
  const start = page.getByTestId('start-stop');
  await start.click();

  await expect(page.getByRole('alert')).toHaveText(
    'Нет доступа к микрофону. Разрешите доступ в настройках браузера.',
  );
  await expect(start).toHaveText('Начать');
  await expect(start).toBeEnabled();
  await expect(page.getByTestId('note-name')).toHaveText('–');

  await start.click();
  await expect(start).toHaveText('Стоп');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('note-name')).toHaveText('ля');
});

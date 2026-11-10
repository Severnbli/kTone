import { expect, test } from '@playwright/test';
import { fakeMicLaunchOptions } from './fakeMic';

test.use({ launchOptions: fakeMicLaunchOptions('a440.wav') });

// Capture the real MediaStream and AudioContext objects the app creates so
// the tests can trigger system-like interruptions on them.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __streams: MediaStream[]; __contexts: AudioContext[] };
    w.__streams = [];
    w.__contexts = [];
    const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (c) => {
      const s = await gum(c);
      w.__streams.push(s);
      return s;
    };
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(o?: AudioContextOptions) {
        super(o);
        w.__contexts.push(this);
      }
    };
  });
  await page.goto('/');
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
});

test('a suspended context resumes on its own while visible', async ({ page }) => {
  await page.evaluate(async () => {
    const w = window as unknown as { __contexts: AudioContext[] };
    await w.__contexts[0].suspend();
  });
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { __contexts: AudioContext[] }).__contexts[0].state,
      ),
    )
    .toBe('running');
  await expect(page.getByTestId('start-stop')).toHaveText('Стоп');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByTestId('note-name')).toHaveText('ля');
});

test('an ended mic track stops listening and explains why', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as unknown as { __streams: MediaStream[] };
    const track = w.__streams[0].getAudioTracks()[0];
    // track.stop() does not fire `ended`; emulate the device going away.
    track.stop();
    Object.defineProperty(track, 'readyState', { value: 'ended' });
    track.dispatchEvent(new Event('ended'));
  });
  await expect(page.getByRole('alert')).toContainText('Микрофон отключился');
  await expect(page.getByTestId('start-stop')).toHaveText('Начать');

  // Starting again gets a fresh microphone.
  await page.getByTestId('start-stop').click();
  await expect(page.getByTestId('note-name')).toHaveText('ля');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

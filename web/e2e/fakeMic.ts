import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Chromium launch options that feed `fixtures/<wav>` in as the microphone. */
export function fakeMicLaunchOptions(wav: string) {
  const file = join(FIXTURES, wav);
  if (!existsSync(file)) {
    throw new Error(`${file} is missing: run \`node scripts/gen-wav.mjs\` first`);
  }
  return {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${file}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  };
}

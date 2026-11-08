// Generates the fake microphone inputs used by the Playwright tests:
// steady sines as 16-bit mono PCM WAV files in e2e/fixtures/. Each entry is
// a frequency, or `[frequency, amplitude]` (default amplitude 0.5).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 48000;
const SECONDS = 4;

const FIXTURES = {
  'a440.wav': 440, // A4
  'a466.wav': 440 * 2 ** (1 / 12), // A♯4 / B♭4
  // A4 at −55 dBFS RMS: above the noise floor, below the analyzer gate (−46).
  'a440-quiet.wav': [440, Math.SQRT2 * 10 ** (-55 / 20)],
  // A4 at full scale: clips.
  'a440-loud.wav': [440, 1],
};

function sineWav(hz, seconds = SECONDS, sampleRate = SAMPLE_RATE, amplitude = 0.5) {
  // Whole number of periods so the looped file has no click.
  const periods = Math.max(1, Math.round(hz * seconds));
  const n = Math.round((periods / hz) * sampleRate);
  const data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) {
    const v = amplitude * Math.sin((2 * Math.PI * hz * i) / sampleRate);
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures');
mkdirSync(outDir, { recursive: true });
for (const [name, spec] of Object.entries(FIXTURES)) {
  const [hz, amplitude = 0.5] = Array.isArray(spec) ? spec : [spec];
  writeFileSync(join(outDir, name), sineWav(hz, SECONDS, SAMPLE_RATE, amplitude));
  console.log(`wrote ${name} (${hz.toFixed(2)} Hz, amplitude ${amplitude.toFixed(4)})`);
}

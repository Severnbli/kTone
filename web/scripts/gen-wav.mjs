// Generates the fake microphone inputs used by the Playwright tests:
// steady tones as 16-bit mono PCM WAV files in e2e/fixtures/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLE_RATE = 48000;
const SECONDS = 4;

const sine = (amplitude) => (phase) => amplitude * Math.sin(phase);

// What the mic hears from the app drone (web/src/audio/drone.ts) over
// speakers: the sine on the tonic and the triangle an octave up (its 1st and
// 3rd harmonics at 0.25 gain), quiet, plus a little room noise.
const leakedDrone = (phase) =>
  0.06 * (Math.sin(phase) + 0.2 * Math.sin(2 * phase) - 0.0225 * Math.sin(6 * phase));

const C3 = 440 * 2 ** (-21 / 12);

// name: [frequency, waveform of the phase, seconds, noise level]
const FIXTURES = {
  'a440.wav': [440, sine(0.5)], // A4
  'a466.wav': [440 * 2 ** (1 / 12), sine(0.5)], // A♯4 / B♭4
  // A4 at −55 dBFS RMS: above the noise floor, below the analyzer gate (−46).
  'a440-quiet.wav': [440, sine(Math.SQRT2 * 10 ** (-55 / 20))],
  // A4 at full scale: clips.
  'a440-loud.wav': [440, sine(1)],
  // The default drone (C major, octave 3, A4 = 440) leaking into the mic.
  'drone-c3.wav': [C3, leakedDrone, 2, 0.0003],
};

/** xorshift32, so the fixtures are reproducible. */
function noise(seed = 1) {
  let x = seed;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32 - 0.5;
  };
}

function toneWav(hz, wave, seconds = SECONDS, noiseLevel = 0, sampleRate = SAMPLE_RATE) {
  // Whole number of periods so the looped file has no click.
  const periods = Math.max(1, Math.round(hz * seconds));
  const n = Math.round((periods / hz) * sampleRate);
  const data = Buffer.alloc(n * 2);
  const rand = noise();
  for (let i = 0; i < n; i++) {
    const v = wave((2 * Math.PI * hz * i) / sampleRate) + noiseLevel * rand();
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
for (const [name, [hz, wave, seconds, noiseLevel]] of Object.entries(FIXTURES)) {
  writeFileSync(join(outDir, name), toneWav(hz, wave, seconds, noiseLevel));
  console.log(`wrote ${name} (${hz.toFixed(2)} Hz)`);
}

// Generates the fake microphone inputs used by the Playwright tests:
// steady tones and room noise as 16-bit mono PCM WAV files in e2e/fixtures/.
// Chromium loops the file.
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
const G1 = 440 * 2 ** (-38 / 12);

// A low bass voice: the 2nd harmonic stronger than the fundamental.
const bassVoice = (phase) =>
  0.12 * Math.sin(phase) +
  0.3 * Math.sin(2 * phase) +
  0.2 * Math.sin(3 * phase) +
  0.1 * Math.sin(4 * phase);

// name: [frequency, waveform of the phase, seconds, noise level]
const FIXTURES = {
  'a440.wav': [440, sine(0.5)], // A4
  'a466.wav': [440 * 2 ** (1 / 12), sine(0.5)], // A♯4 / B♭4
  // A4 at full scale: clips.
  'a440-loud.wav': [440, sine(1)],
  // The default drone (C major, octave 3, A4 = 440) leaking into the mic.
  'drone-c3.wav': [C3, leakedDrone, 2, 0.0003],
  // G1 (49 Hz), shown only in low range mode.
  'g1.wav': [G1, bassVoice],
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
  return Buffer.concat([wavHeader(data.length, sampleRate), data]);
}

function wavHeader(dataLength, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLength, 4);
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
  header.writeUInt32LE(dataLength, 40);
  return header;
}

const dbfs = (db) => 10 ** (db / 20);

/** White noise with the given RMS (uniform, reproducible). */
function whiteNoise(n, rms, seed) {
  const rand = noise(seed);
  const a = Math.sqrt(12) * rms;
  return Float64Array.from({ length: n }, () => a * rand());
}

/** Pink-ish room noise (Paul Kellet's filter) plus 50/100 Hz hum 12 dB down, at `rms`. */
function roomNoise(n, rms, seed, sampleRate = SAMPLE_RATE) {
  const rand = noise(seed);
  const b = [0, 0, 0, 0, 0, 0, 0];
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const w = 2 * rand();
    b[0] = 0.99886 * b[0] + w * 0.0555179;
    b[1] = 0.99332 * b[1] + w * 0.0750759;
    b[2] = 0.969 * b[2] + w * 0.153852;
    b[3] = 0.8665 * b[3] + w * 0.3104856;
    b[4] = 0.55 * b[4] + w * 0.5329522;
    b[5] = -0.7616 * b[5] - w * 0.016898;
    out[i] = b.reduce((s, v) => s + v, 0) + w * 0.5362;
    b[6] = w * 0.115926;
  }
  scaleTo(out, 1);
  const hum = dbfs(-12);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] += hum * (Math.sin(2 * Math.PI * 50 * t) + 0.5 * Math.sin(2 * Math.PI * 100 * t + 0.7));
  }
  return scaleTo(out, rms);
}

function scaleTo(samples, rms) {
  const now = Math.sqrt(samples.reduce((s, v) => s + v * v, 0) / samples.length);
  for (let i = 0; i < samples.length; i++) samples[i] *= rms / now;
  return samples;
}

function wav(samples, sampleRate = SAMPLE_RATE) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => {
    data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), i * 2);
  });
  return Buffer.concat([wavHeader(data.length, sampleRate), data]);
}

// Noise-based fixtures: name -> samples.
const NOISE_FIXTURES = {
  // A quiet room (white noise at −68 dBFS RMS) for 1.5 s, then for 3 s A4 at
  // −60 dBFS on top: the analyzer calibrates its gate to about −57 dBFS on
  // the room, so the singer stays below it but well above the noise.
  'a440-quiet.wav': (() => {
    const lead = Math.round(1.5 * SAMPLE_RATE);
    const tone = Math.round(3 * SAMPLE_RATE);
    const out = whiteNoise(lead + tone, dbfs(-68), 3);
    const amp = Math.SQRT2 * dbfs(-60);
    for (let i = 0; i < tone; i++) {
      out[lead + i] += amp * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
    return out;
  })(),
  // A4 for 1 s (10 ms fades), then 5 s of a quiet room (white noise at
  // −70 dBFS): the singer stops. Long enough that the loop does not bring the
  // note back while a test looks at the silence.
  'a440-then-silence.wav': (() => {
    const tone = SAMPLE_RATE;
    const out = whiteNoise(6 * SAMPLE_RATE, dbfs(-70), 7);
    const fade = 0.01 * SAMPLE_RATE;
    for (let i = 0; i < tone; i++) {
      const env = Math.min(1, i / fade, (tone - i) / fade);
      out[i] += 0.5 * env * Math.sin((2 * Math.PI * 440 * i) / SAMPLE_RATE);
    }
    return out;
  })(),
  // A noisy room: pink-ish noise with mains hum at −40 dBFS RMS, no voice.
  'room-noise.wav': roomNoise(4 * SAMPLE_RATE, dbfs(-40), 5),
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e', 'fixtures');
mkdirSync(outDir, { recursive: true });
for (const [name, [hz, wave, seconds, noiseLevel]] of Object.entries(FIXTURES)) {
  writeFileSync(join(outDir, name), toneWav(hz, wave, seconds, noiseLevel));
  console.log(`wrote ${name} (${hz.toFixed(2)} Hz)`);
}
for (const [name, samples] of Object.entries(NOISE_FIXTURES)) {
  writeFileSync(join(outDir, name), wav(samples));
  console.log(`wrote ${name} (${(samples.length / SAMPLE_RATE).toFixed(1)} s)`);
}

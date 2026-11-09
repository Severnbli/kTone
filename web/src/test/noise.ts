// Room-noise helper for the noise-gate tests of both engines.
import type { Analyzer } from '../engine/types';

const toDb = (v: number) => 20 * Math.log10(v);

/**
 * Feeds `seconds` of uniform white noise at `dbfs` RMS hop by hop. Returns how
 * many frames were pitched and the analyzer's floor and gate in dBFS after.
 */
export function feedNoise(
  analyzer: Analyzer,
  dbfs: number,
  seconds = 1,
  sampleRate = 48_000,
  seed = 1,
): { pitched: number; floorDb: number | null; gateDb: number } {
  // Uniform noise in ±a/2 has RMS a/√12.
  const a = Math.sqrt(12) * 10 ** (dbfs / 20);
  let x = seed;
  const next = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 2 ** 32 - 0.5;
  };
  const n = analyzer.frameSize;
  const hop = analyzer.hopSize;
  const frame = new Float32Array(n);
  for (let i = 0; i < n; i++) frame[i] = a * next();
  let pitched = 0;
  const hops = Math.round((seconds * sampleRate) / hop);
  for (let h = 0; h < hops; h++) {
    frame.copyWithin(0, hop);
    for (let i = n - hop; i < n; i++) frame[i] = a * next();
    if (analyzer.process(frame)) pitched++;
  }
  const floor = analyzer.noiseFloor;
  return { pitched, floorDb: floor === null ? null : toDb(floor), gateDb: toDb(analyzer.gate) };
}

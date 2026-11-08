import { describe, expect, it } from 'vitest';
import { classifyCents, needlePercent } from './zones';

describe('classifyCents', () => {
  const t = { green: 10, yellow: 25 };
  it('classifies by absolute deviation with inclusive bounds', () => {
    expect(classifyCents(0, t)).toBe('green');
    expect(classifyCents(10, t)).toBe('green');
    expect(classifyCents(-10, t)).toBe('green');
    expect(classifyCents(10.1, t)).toBe('yellow');
    expect(classifyCents(-25, t)).toBe('yellow');
    expect(classifyCents(25.5, t)).toBe('red');
    expect(classifyCents(-49, t)).toBe('red');
  });
  it('respects custom thresholds', () => {
    expect(classifyCents(12, { green: 15, yellow: 30 })).toBe('green');
    expect(classifyCents(8, { green: 5, yellow: 8 })).toBe('yellow');
  });
});

describe('needlePercent', () => {
  it('maps ±50 cents to 0..100% and clamps', () => {
    expect(needlePercent(0)).toBe(50);
    expect(needlePercent(-50)).toBe(0);
    expect(needlePercent(25)).toBe(75);
    expect(needlePercent(120)).toBe(100);
  });
});

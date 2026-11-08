import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LevelStore } from '../audio/level';
import { LevelMeter } from './LevelMeter';

function sine(amplitude: number, n = 2048): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / 48000);
  return out;
}

function setup(gateDbfs?: number) {
  const levels = new LevelStore();
  render(<LevelMeter levels={levels} gateDbfs={gateDbfs} />);
  return { levels, meter: screen.getByTestId('level-meter') };
}

describe('LevelMeter', () => {
  it('starts empty with the gate marker at −46 dBFS', () => {
    const { meter } = setup();
    expect(meter).toHaveAttribute('data-state', 'off');
    expect(screen.getByTestId('level-fill').style.width).toBe('0%');
    const left = parseFloat(screen.getByTestId('level-gate').style.left);
    expect(left).toBeCloseTo(((70 - 46.02) / 70) * 100, 1);
    expect(screen.queryByTestId('level-hint')).toBeNull();
  });

  it('follows the level of every frame', () => {
    const { levels, meter } = setup();
    act(() => levels.push(sine(0.5), true, 0));
    expect(meter).toHaveAttribute('data-state', 'ok');
    expect(meter).toHaveAttribute('data-level', '-9');
    expect(meter).toHaveAttribute('aria-valuenow', '-9');
    expect(parseFloat(screen.getByTestId('level-fill').style.width)).toBeCloseTo(87.1, 0);

    act(() => levels.push(sine(0.001), false, 10));
    expect(meter).toHaveAttribute('data-state', 'low');
    act(() => levels.push(sine(1), true, 20));
    expect(meter).toHaveAttribute('data-state', 'clip');
    act(() => levels.push(new Float32Array(2048), false, 30));
    expect(meter).toHaveAttribute('data-state', 'off');
    expect(meter).toHaveAttribute('data-level', '');
  });

  it('places the marker at a custom gate', () => {
    setup(-35);
    expect(screen.getByTestId('level-gate').style.left).toBe('50%');
  });

  it('shows the too-quiet hint after a second of quiet input, and hides it on reset', () => {
    const { levels } = setup();
    // −55 dBFS RMS: above the noise floor, below the gate.
    const quiet = sine(Math.SQRT2 * Math.pow(10, -55 / 20));
    act(() => {
      for (let t = 0; t < 900; t += 10) levels.push(quiet, false, t);
    });
    expect(screen.queryByTestId('level-hint')).toBeNull();
    act(() => {
      for (let t = 900; t <= 1100; t += 10) levels.push(quiet, false, t);
    });
    expect(screen.getByRole('status')).toHaveTextContent('Слишком тихо');
    act(() => levels.reset());
    expect(screen.queryByTestId('level-hint')).toBeNull();
  });

  it('shows the too-loud hint while clipping', () => {
    const { levels } = setup();
    act(() => {
      for (let t = 0; t <= 400; t += 10) levels.push(sine(1), true, t);
    });
    expect(screen.getByTestId('level-hint')).toHaveAttribute('data-hint', 'loud');
    expect(screen.getByTestId('level-hint')).toHaveTextContent('Слишком громко');
  });
});

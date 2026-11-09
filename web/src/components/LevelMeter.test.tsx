import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LevelStore } from '../audio/level';
import { LevelMeter } from './LevelMeter';

function sine(amplitude: number, n = 2048): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / 48000);
  return out;
}

const lin = (db: number) => 10 ** (db / 20);
/** The default analyzer gate (−46 dBFS) before the floor is known. */
const DEFAULT_GATE = 0.005;

function setup() {
  const levels = new LevelStore();
  render(<LevelMeter levels={levels} />);
  return { levels, meter: screen.getByTestId('level-meter') };
}

describe('LevelMeter', () => {
  it('starts empty, without a gate marker or floor band', () => {
    const { meter } = setup();
    expect(meter).toHaveAttribute('data-state', 'off');
    expect(meter).toHaveAttribute('data-gate', '');
    expect(screen.getByTestId('level-fill').style.width).toBe('0%');
    expect(screen.getByTestId('level-gate')).not.toBeVisible();
    expect(screen.getByTestId('level-floor')).not.toBeVisible();
    expect(screen.queryByTestId('level-hint')).toBeNull();
  });

  it('places the marker at the live gate and the band at the floor', () => {
    const { levels, meter } = setup();
    act(() => levels.push(sine(0.001), false, 0, DEFAULT_GATE, null));
    const gate = screen.getByTestId('level-gate');
    expect(gate).toBeVisible();
    expect(parseFloat(gate.style.left)).toBeCloseTo(((70 - 46.02) / 70) * 100, 1);
    expect(screen.getByTestId('level-floor')).not.toBeVisible();
    expect(meter).toHaveAttribute('data-gate', '-46.0');

    act(() => levels.push(sine(0.001), false, 10, lin(-35), lin(-56)));
    expect(gate.style.left).toBe('50%');
    const floor = screen.getByTestId('level-floor');
    expect(floor).toBeVisible();
    expect(parseFloat(floor.style.width)).toBeCloseTo(20, 5);
    expect(meter).toHaveAttribute('data-floor', '-56.0');

    act(() => levels.reset());
    expect(gate).not.toBeVisible();
    expect(floor).not.toBeVisible();
  });

  it('follows the level of every frame', () => {
    const { levels, meter } = setup();
    act(() => levels.push(sine(0.5), true, 0, DEFAULT_GATE, null));
    expect(meter).toHaveAttribute('data-state', 'ok');
    expect(meter).toHaveAttribute('data-level', '-9');
    expect(meter).toHaveAttribute('aria-valuenow', '-9');
    expect(parseFloat(screen.getByTestId('level-fill').style.width)).toBeCloseTo(87.1, 0);

    act(() => levels.push(sine(0.001), false, 10, DEFAULT_GATE, null));
    expect(meter).toHaveAttribute('data-state', 'low');
    act(() => levels.push(sine(1), true, 20, DEFAULT_GATE, null));
    expect(meter).toHaveAttribute('data-state', 'clip');
    act(() => levels.push(new Float32Array(2048), false, 30, DEFAULT_GATE, null));
    expect(meter).toHaveAttribute('data-state', 'off');
    expect(meter).toHaveAttribute('data-level', '');
  });

  it('shows the too-quiet hint after a second of quiet input, and hides it on reset', () => {
    const { levels } = setup();
    // −58 dBFS RMS: above the −66 dBFS floor, below the −55 dBFS gate.
    const quiet = sine(Math.SQRT2 * lin(-58));
    act(() => {
      for (let t = 0; t < 900; t += 10) levels.push(quiet, false, t, lin(-55), lin(-66));
    });
    expect(screen.queryByTestId('level-hint')).toBeNull();
    act(() => {
      for (let t = 900; t <= 1100; t += 10) levels.push(quiet, false, t, lin(-55), lin(-66));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Слишком тихо');
    act(() => levels.reset());
    expect(screen.queryByTestId('level-hint')).toBeNull();
  });

  it('shows the too-loud hint while clipping', () => {
    const { levels } = setup();
    act(() => {
      for (let t = 0; t <= 400; t += 10) levels.push(sine(1), true, t, DEFAULT_GATE, null);
    });
    expect(screen.getByTestId('level-hint')).toHaveAttribute('data-hint', 'loud');
    expect(screen.getByTestId('level-hint')).toHaveTextContent('Слишком громко');
  });

  it('shows the noisy-room hint when the gate stays at its maximum', () => {
    const { levels } = setup();
    const roomNoise = sine(Math.SQRT2 * lin(-41));
    act(() => {
      for (let t = 0; t <= 3100; t += 10) levels.push(roomNoise, false, t, lin(-34), lin(-44));
    });
    expect(screen.getByTestId('level-hint')).toHaveAttribute('data-hint', 'noisy');
    expect(screen.getByTestId('level-hint')).toHaveTextContent(
      'Вокруг шумно – распознавание может пропускать тихие ноты',
    );
  });
});

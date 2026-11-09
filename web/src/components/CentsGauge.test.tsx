import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import { frame } from '../test/frames';
import { CentsGauge } from './CentsGauge';

function setup(zones = { green: 10, yellow: 25 }) {
  const store = new PitchStore();
  const utils = render(<CentsGauge store={store} zones={zones} />);
  return { store, gauge: screen.getByTestId('cents-gauge'), ...utils };
}

describe('CentsGauge', () => {
  it('starts with no zone', () => {
    const { gauge } = setup();
    expect(gauge).toHaveAttribute('data-zone', 'none');
  });

  it.each([
    [0, 'green'],
    [-9, 'green'],
    [18, 'yellow'],
    [-25, 'yellow'],
    [40, 'red'],
  ])('%d cents -> %s', (cents, zone) => {
    const { store, gauge } = setup();
    act(() => store.push(frame(69, cents), 0));
    expect(gauge).toHaveAttribute('data-zone', zone);
    expect(gauge).toHaveAttribute('aria-valuenow', String(cents));
    expect(screen.getByTestId('gauge-readout')).toHaveTextContent(
      `${cents > 0 ? '+' : ''}${cents}`,
    );
  });

  it('positions the needle and clamps beyond ±50', () => {
    const { store } = setup();
    const needle = screen.getByTestId('gauge-needle');
    act(() => store.push(frame(69, 25), 0));
    expect(needle.style.left).toBe('75%');
    act(() => store.push(frame(69, -80), 10));
    expect(needle.style.left).toBe('0%');
  });

  it('uses configurable thresholds', () => {
    const { store, gauge, rerender } = setup({ green: 20, yellow: 30 });
    act(() => store.push(frame(69, 15), 0));
    expect(gauge).toHaveAttribute('data-zone', 'green');
    rerender(<CentsGauge store={store} zones={{ green: 5, yellow: 10 }} />);
    expect(gauge).toHaveAttribute('data-zone', 'red');
  });

  it('follows the vibrato center, not the per-frame pitch', () => {
    const { store, gauge } = setup();
    const needle = screen.getByTestId('gauge-needle');
    for (const [i, raw] of [40, -38, 35, -40].entries()) {
      act(() => store.push(frame(69, raw, { centerCents: 3 }), i * 10));
      expect(gauge).toHaveAttribute('data-zone', 'green');
      expect(gauge).toHaveAttribute('aria-valuenow', '3');
      expect(screen.getByTestId('gauge-readout')).toHaveTextContent('+3');
      expect(needle.style.left).toBe('53%');
    }
    act(() => store.push(frame(69, 0, { centerCents: -20 }), 50));
    expect(gauge).toHaveAttribute('data-zone', 'yellow');
  });

  it('shows no zone until the center is ready, but moves the needle', () => {
    const { store, gauge } = setup();
    const needle = screen.getByTestId('gauge-needle');
    act(() => store.push(frame(69, 40, { centerReady: false }), 0));
    expect(gauge).toHaveAttribute('data-zone', 'pending');
    expect(gauge).toHaveAttribute('data-dir', 'none');
    expect(needle.style.left).toBe('90%');
    act(() => store.push(frame(69, 40), 10));
    expect(gauge).toHaveAttribute('data-zone', 'red');
    expect(gauge).toHaveAttribute('data-dir', 'sharp');
  });

  it('returns to no zone on silence', () => {
    const { store, gauge } = setup();
    act(() => store.push(frame(69, 0), 0));
    act(() => store.push(null, 10));
    expect(gauge).toHaveAttribute('data-zone', 'none');
  });
});

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import { frame } from '../test/frames';
import { ANNOUNCE_DELAY_MS, CentsGauge } from './CentsGauge';

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

  describe('with a target', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setupTarget(targetMidi: number) {
      const store = new PitchStore();
      render(
        <CentsGauge store={store} zones={{ green: 10, yellow: 25 }} targetMidi={targetMidi} />,
      );
      return {
        store,
        gauge: screen.getByTestId('cents-gauge'),
        needle: screen.getByTestId('gauge-needle'),
        message: screen.getByTestId('gauge-message'),
      };
    }

    it('measures the vibrato center from the target, not the nearest semitone', () => {
      const { store, gauge, needle, message } = setupTarget(69);
      expect(gauge).toHaveAttribute('data-target', 'none');
      // Sung A4 a little sharp: hit.
      act(() => store.push(frame(69, 30, { centerCents: 4 }), 0));
      expect(gauge).toHaveAttribute('data-target', 'near');
      expect(gauge).toHaveAttribute('data-zone', 'green');
      expect(screen.getByTestId('gauge-readout')).toHaveTextContent('+4');
      expect(parseFloat(needle.style.left)).toBeCloseTo(54);
      expect(message).toHaveTextContent('');
      // Sung B♭4 40 cents flat (center 69.6): 60 cents above A4, i.e. a semitone off.
      act(() => store.push(frame(70, -40), 10));
      expect(gauge).toHaveAttribute('data-target', 'far');
    });

    it('judges the zones relative to the target', () => {
      const { store, gauge } = setupTarget(69);
      act(() => store.push(frame(69, -20), 0));
      expect(gauge).toHaveAttribute('data-zone', 'yellow');
      expect(gauge).toHaveAttribute('data-dir', 'flat');
    });

    it('far away: pins the needle and says where to go', () => {
      const { store, gauge, needle, message } = setupTarget(67);
      act(() => store.push(frame(69), 0));
      expect(gauge).toHaveAttribute('data-target', 'far');
      expect(gauge).toHaveAttribute('data-zone', 'red');
      expect(gauge).toHaveAttribute('data-dir', 'sharp');
      expect(needle.style.left).toBe('100%');
      expect(message).toHaveTextContent('ниже на 2 полутона');
      expect(gauge).toHaveAttribute('aria-valuetext', 'ниже на 2 полутона');
      expect(gauge).toHaveAttribute('aria-valuenow', '50');
      act(() => store.push(frame(66), 10));
      expect(message).toHaveTextContent('выше на 1 полутон');
      expect(gauge).toHaveAttribute('data-dir', 'flat');
      expect(needle.style.left).toBe('0%');
    });

    it('the right note in the wrong octave gets an octave hint', () => {
      const { store, gauge, message } = setupTarget(57);
      act(() => store.push(frame(69), 0));
      expect(gauge).toHaveAttribute('data-target', 'octave');
      expect(message).toHaveTextContent('нота верная, октава выше');
      act(() => store.push(frame(45), 10));
      expect(message).toHaveTextContent('нота верная, октава ниже');
    });

    it('announces a message once it holds, not every frame', () => {
      vi.useFakeTimers();
      const { store } = setupTarget(67);
      const live = screen.getByTestId('gauge-live');
      for (let i = 0; i < 5; i++) {
        act(() => store.push(frame(69), i * 10));
        act(() => vi.advanceTimersByTime(100));
      }
      expect(live).toHaveTextContent('');
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      expect(live).toHaveTextContent('ниже на 2 полутона');
      // A brief change does not interrupt.
      act(() => store.push(frame(66), 100));
      act(() => vi.advanceTimersByTime(100));
      act(() => store.push(frame(69), 110));
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS * 2));
      expect(live).toHaveTextContent('ниже на 2 полутона');
      // Back on target: the message clears quietly.
      act(() => store.push(frame(67), 120));
      act(() => vi.advanceTimersByTime(ANNOUNCE_DELAY_MS));
      expect(live).toHaveTextContent('');
      expect(live).toHaveAttribute('aria-live', 'polite');
      expect(screen.getByTestId('cents-gauge')).not.toContainElement(live);
    });

    it('back to the nearest semitone when the target is cleared', () => {
      const store = new PitchStore();
      const { rerender } = render(
        <CentsGauge store={store} zones={{ green: 10, yellow: 25 }} targetMidi={67} />,
      );
      act(() => store.push(frame(69, 3), 0));
      const gauge = screen.getByTestId('cents-gauge');
      expect(gauge).toHaveAttribute('data-target', 'far');
      rerender(<CentsGauge store={store} zones={{ green: 10, yellow: 25 }} targetMidi={null} />);
      expect(gauge).toHaveAttribute('data-target', 'off');
      expect(gauge).toHaveAttribute('data-zone', 'green');
      expect(screen.getByTestId('gauge-message')).toHaveTextContent('');
    });
  });

  it('returns to no zone on silence', () => {
    const { store, gauge } = setup();
    act(() => store.push(frame(69, 0), 0));
    act(() => store.push(null, 10));
    expect(gauge).toHaveAttribute('data-zone', 'none');
  });
});

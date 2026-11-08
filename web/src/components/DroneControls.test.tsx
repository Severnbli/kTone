import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drone, droneMidi } from '../audio/drone';
import { BACKGROUND_STOP_MS } from '../audio/lifecycle';
import { DEFAULT_SETTINGS } from '../settings';
import { FakeAudioContext, fakeVisibility, flush } from '../test/fakes';
import { DroneControls } from './DroneControls';

describe('DroneControls', () => {
  it('labels the tonic in the selected octave and toggles', () => {
    const onChange = vi.fn();
    render(
      <DroneControls
        settings={{ ...DEFAULT_SETTINGS, key: { tonic: 'D', accidental: 0, mode: 'major' } }}
        naming="solfege"
        onChange={onChange}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn).toHaveTextContent('ре малой октавы');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn); // jsdom has no AudioContext: start is a no-op
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(/наушники/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Октава'), { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith({ volume: 0.3, octave: 4 });
    fireEvent.change(screen.getByLabelText('Громкость'), { target: { value: '0.8' } });
    expect(onChange).toHaveBeenLastCalledWith({ volume: 0.8, octave: 3 });
  });

  describe('lifecycle', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    function setup(hidden = false) {
      const ctx = new FakeAudioContext();
      const visibility = fakeVisibility(hidden);
      const onPlayingChange = vi.fn();
      render(
        <DroneControls
          settings={DEFAULT_SETTINGS}
          naming="solfege"
          onChange={() => undefined}
          onPlayingChange={onPlayingChange}
          visibility={visibility}
          createDrone={() => new Drone(() => ctx.asAudioContext())}
        />,
      );
      const btn = screen.getByRole('button');
      return { ctx, visibility, onPlayingChange, btn };
    }

    async function turnOn(btn: HTMLElement) {
      fireEvent.click(btn);
      await act(() => flush());
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    }

    it('reports playing changes', async () => {
      const { btn, onPlayingChange } = setup();
      await turnOn(btn);
      expect(onPlayingChange).toHaveBeenLastCalledWith(true);
      fireEvent.click(btn);
      expect(onPlayingChange).toHaveBeenLastCalledWith(false);
    });

    it('resumes after a system pause when possible', async () => {
      const { btn, ctx } = setup();
      await turnOn(btn);
      await act(async () => {
        ctx.setState('interrupted');
        await flush();
      });
      expect(ctx.state).toBe('running');
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('stops and explains when the pause cannot be undone', async () => {
      const { btn, ctx } = setup();
      await turnOn(btn);
      ctx.resumeWorks = false;
      await act(async () => {
        ctx.setState('interrupted');
        await flush();
      });
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(screen.getByTestId('drone-interrupted')).toHaveTextContent('Бурдон остановлен');

      // Tapping again (a user gesture) restarts it and clears the message.
      ctx.resumeWorks = true;
      await turnOn(btn);
      expect(screen.queryByTestId('drone-interrupted')).toBeNull();
    });

    it('waits for the page to be visible before resuming', async () => {
      const { btn, ctx, visibility } = setup();
      await turnOn(btn);
      ctx.resume.mockClear();
      await act(async () => {
        visibility.set(true);
        ctx.setState('suspended');
        await flush();
      });
      expect(ctx.resume).not.toHaveBeenCalled();
      await act(async () => {
        visibility.set(false);
        await flush();
      });
      expect(ctx.resume).toHaveBeenCalled();
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    });

    it('stops after staying in the background too long', async () => {
      const { btn, visibility } = setup();
      await turnOn(btn);
      vi.useFakeTimers();
      act(() => visibility.set(true));
      act(() => vi.advanceTimersByTime(BACKGROUND_STOP_MS));
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(screen.queryByTestId('drone-interrupted')).toBeNull();
    });
  });

  it('droneMidi computes the tonic pitch', () => {
    expect(droneMidi(2, 0, 3)).toBe(50); // D3
    expect(droneMidi(0, -1, 4)).toBe(59); // C♭4 = B3
  });
});

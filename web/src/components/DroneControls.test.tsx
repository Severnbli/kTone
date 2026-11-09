import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Drone, droneMidi } from '../audio/drone';
import { BACKGROUND_STOP_MS } from '../audio/lifecycle';
import { DRONE_LEAK_GAP_MS, DRONE_LEAK_SHOW_MS, PitchStore } from '../audio/pitchStore';
import { DEFAULT_SETTINGS } from '../settings';
import { FakeAudioContext, fakeVisibility, flush } from '../test/fakes';
import { DroneControls } from './DroneControls';

/** Opens the drone sheet from the bottom-bar button and returns its on/off toggle. */
function openSheet() {
  fireEvent.click(screen.getByTestId('drone-open'));
  return screen.getByTestId('drone-toggle');
}

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
    const open = screen.getByTestId('drone-open');
    expect(open).toHaveAccessibleName('Бурдон · ре малой октавы, выключен');
    expect(open).toHaveTextContent('ре · малая');
    const btn = openSheet();
    expect(screen.getByRole('dialog', { name: 'Бурдон' })).toBeInTheDocument();
    expect(btn).toHaveTextContent('ре малой октавы');
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(btn); // jsdom has no AudioContext: start is a no-op
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(open).toHaveAccessibleName('Бурдон · ре малой октавы, звучит');
    expect(screen.getByText(/наушники/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('ре первой октавы'));
    expect(onChange).toHaveBeenLastCalledWith({ volume: 0.3, octave: 4 });
    fireEvent.change(screen.getByLabelText('Громкость'), { target: { value: '0.8' } });
    expect(onChange).toHaveBeenLastCalledWith({ volume: 0.8, octave: 3 });
  });

  it('reports the playing frequency and shows the leak hint while the mic hears the drone', () => {
    const store = new PitchStore();
    const onPlayingChange = vi.fn();
    const { rerender } = render(
      <DroneControls
        settings={DEFAULT_SETTINGS}
        naming="solfege"
        onChange={() => undefined}
        onPlayingChange={onPlayingChange}
        store={store}
      />,
    );
    expect(onPlayingChange).toHaveBeenLastCalledWith(null);
    const btn = openSheet();
    fireEvent.click(btn);
    // C3 at A4 = 440.
    expect(onPlayingChange).toHaveBeenLastCalledWith(expect.closeTo(130.81, 2));
    rerender(
      <DroneControls
        settings={{ ...DEFAULT_SETTINGS, a4Hz: 442 }}
        naming="solfege"
        onChange={() => undefined}
        onPlayingChange={onPlayingChange}
        store={store}
      />,
    );
    expect(onPlayingChange).toHaveBeenLastCalledWith(expect.closeTo(131.4, 1));

    const hint = () => screen.queryByTestId('drone-leak-hint');
    let t = 0;
    const push = (ms: number, leak: boolean) => {
      act(() => {
        for (const end = t + ms; t < end; t += 10) store.push(null, t, leak);
      });
    };
    push(DRONE_LEAK_SHOW_MS - 100, true);
    expect(hint()).toBeNull();
    push(200, true);
    expect(hint()).toHaveTextContent('Микрофон слышит бурдон');
    push(DRONE_LEAK_GAP_MS + 20, false);
    expect(hint()).toBeNull();

    push(DRONE_LEAK_SHOW_MS + 100, true);
    expect(hint()).not.toBeNull();
    fireEvent.click(btn);
    expect(hint()).toBeNull();
    expect(onPlayingChange).toHaveBeenLastCalledWith(null);
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
      const btn = openSheet();
      return { ctx, visibility, onPlayingChange, btn };
    }

    async function turnOn(btn: HTMLElement) {
      fireEvent.click(btn);
      await act(() => flush());
      expect(btn).toHaveAttribute('aria-pressed', 'true');
    }

    it('reports the drone before its audio starts, and null when it stops', async () => {
      const { btn, ctx, onPlayingChange } = setup();
      // The analyzer must know the drone before the mic can hear it.
      fireEvent.click(btn);
      expect(ctx.oscillators).toHaveLength(0);
      expect(onPlayingChange).toHaveBeenLastCalledWith(expect.closeTo(130.81, 2));
      await act(() => flush());
      expect(ctx.oscillators.length).toBeGreaterThan(0);
      fireEvent.click(btn);
      expect(onPlayingChange).toHaveBeenLastCalledWith(null);
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
      const { btn, ctx, onPlayingChange } = setup();
      await turnOn(btn);
      ctx.resumeWorks = false;
      await act(async () => {
        ctx.setState('interrupted');
        await flush();
      });
      expect(btn).toHaveAttribute('aria-pressed', 'false');
      expect(onPlayingChange).toHaveBeenLastCalledWith(null);
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

  it('plays the target instead of the tonic when asked to and a target is on', () => {
    const onPlayingChange = vi.fn();
    const onDroneTargetChange = vi.fn();
    const target = { enabled: true, degree: 6, octave: 4 };
    const { rerender } = render(
      <DroneControls
        settings={{ ...DEFAULT_SETTINGS, target }}
        naming="solfege"
        onChange={vi.fn()}
        onDroneTargetChange={onDroneTargetChange}
        onPlayingChange={onPlayingChange}
      />,
    );
    fireEvent.click(openSheet());
    expect(onPlayingChange).toHaveBeenLastCalledWith(expect.closeTo(130.81, 2)); // C3
    const toggle = screen.getByRole('switch', { name: 'Бурдон играет цель' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(onDroneTargetChange).toHaveBeenLastCalledWith(true);
    rerender(
      <DroneControls
        settings={{ ...DEFAULT_SETTINGS, target, droneTarget: true }}
        naming="solfege"
        onChange={vi.fn()}
        onDroneTargetChange={onDroneTargetChange}
        onPlayingChange={onPlayingChange}
      />,
    );
    // The analyzer is told the target's frequency (A4), so the drone filter follows it.
    expect(onPlayingChange).toHaveBeenLastCalledWith(expect.closeTo(440, 6));
    expect(screen.getByTestId('drone-open')).toHaveAccessibleName(
      'Бурдон · ля первой октавы, звучит',
    );
    expect(screen.getByText(/бурдон звучит на целевой ноте/)).toBeInTheDocument();
    // Target off: back to the tonic.
    rerender(
      <DroneControls
        settings={{ ...DEFAULT_SETTINGS, target: { ...target, enabled: false }, droneTarget: true }}
        naming="solfege"
        onChange={vi.fn()}
        onDroneTargetChange={onDroneTargetChange}
        onPlayingChange={onPlayingChange}
      />,
    );
    expect(onPlayingChange).toHaveBeenLastCalledWith(expect.closeTo(130.81, 2));
  });

  it('droneMidi computes the tonic pitch', () => {
    expect(droneMidi(2, 0, 3)).toBe(50); // D3
    expect(droneMidi(0, -1, 4)).toBe(59); // C♭4 = B3
  });
});

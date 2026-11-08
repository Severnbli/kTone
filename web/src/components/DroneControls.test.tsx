import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { droneMidi } from '../audio/drone';
import { DRONE_LEAK_GAP_MS, DRONE_LEAK_SHOW_MS, PitchStore } from '../audio/pitchStore';
import { DEFAULT_SETTINGS } from '../settings';
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
    const btn = screen.getByRole('button');
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

  it('droneMidi computes the tonic pitch', () => {
    expect(droneMidi(2, 0, 3)).toBe(50); // D3
    expect(droneMidi(0, -1, 4)).toBe(59); // C♭4 = B3
  });
});

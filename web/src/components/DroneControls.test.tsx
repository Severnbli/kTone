import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { droneMidi } from '../audio/drone';
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

  it('droneMidi computes the tonic pitch', () => {
    expect(droneMidi(2, 0, 3)).toBe(50); // D3
    expect(droneMidi(0, -1, 4)).toBe(59); // C♭4 = B3
  });
});

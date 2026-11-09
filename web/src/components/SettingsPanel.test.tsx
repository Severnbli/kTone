import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../i18n/I18nProvider';
import { DEFAULT_SETTINGS, type Settings } from '../settings';
import { SettingsPanel } from './SettingsPanel';

function Harness({ onChange }: { onChange: (s: Settings) => void }) {
  const [s, setS] = useState(DEFAULT_SETTINGS);
  return (
    <I18nProvider lang={s.lang}>
      <SettingsPanel
        settings={s}
        onChange={(next) => {
          setS(next);
          onChange(next);
        }}
      />
    </I18nProvider>
  );
}

function setup() {
  const onChange = vi.fn<(s: Settings) => void>();
  render(<Harness onChange={onChange} />);
  const last = () => onChange.mock.calls.at(-1)![0];
  return { onChange, last };
}

describe('SettingsPanel', () => {
  it('groups the settings and leaves key and clef to the header chips', () => {
    setup();
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual([
      'Звук',
      'Нотация',
      'Точность',
      'Интерфейс',
      'О kTone',
    ]);
    expect(screen.queryByLabelText('Тональность')).toBeNull();
    expect(screen.queryByLabelText('Ключ')).toBeNull();
  });

  it('commits A4 only within 415–466', () => {
    const { onChange, last } = setup();
    const input = screen.getByLabelText('Ля первой октавы (A4), Гц');
    fireEvent.change(input, { target: { value: '44' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '442' } });
    expect(last().a4Hz).toBe(442);
    fireEvent.change(input, { target: { value: '500' } });
    expect(last().a4Hz).toBe(442);
    fireEvent.blur(input);
    expect(input).toHaveValue(442);
  });

  it('switches note naming and degree style', () => {
    const { last } = setup();
    fireEvent.click(screen.getByLabelText(/C-D-E/));
    expect(last().naming).toBe('letter');
    fireEvent.click(screen.getByLabelText(/арабские/));
    expect(last().degreeStyle).toBe('arabic');
  });

  it('changes hit-zone thresholds and keeps yellow ≥ green', () => {
    const { last } = setup();
    fireEvent.change(screen.getByLabelText('Зелёная ±'), { target: { value: '30' } });
    expect(last().zones).toEqual({ green: 30, yellow: 30 });
    fireEvent.change(screen.getByLabelText('Жёлтая ±'), { target: { value: '40' } });
    expect(last().zones).toEqual({ green: 30, yellow: 40 });
  });

  it('toggles the drone filter', () => {
    const { last } = setup();
    const box = screen.getByRole('switch', { name: 'Не принимать бурдон за голос' });
    expect(box).toBeChecked();
    fireEvent.click(box);
    expect(last().droneFilter).toBe(false);
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(last().droneFilter).toBe(true);
  });

  it('sets the drone octave and volume', () => {
    const { last } = setup();
    fireEvent.click(screen.getByLabelText('до первой октавы'));
    expect(last().drone).toEqual({ volume: 0.3, octave: 4 });
    fireEvent.change(screen.getByLabelText('Громкость бурдона'), { target: { value: '0.6' } });
    expect(last().drone).toEqual({ volume: 0.6, octave: 4 });
  });

  it('switches the UI language', () => {
    const { last } = setup();
    expect(screen.getByLabelText('Русский')).toBeChecked();
    fireEvent.click(screen.getByLabelText('English'));
    expect(last().lang).toBe('en');
    expect(screen.getByRole('heading', { name: 'Interface' })).toBeInTheDocument();
    expect(screen.getByLabelText('English')).toBeChecked();
  });

  it('switches the theme: system, dark or light', () => {
    const { last } = setup();
    expect(screen.getByLabelText('Как в системе')).toBeChecked();
    fireEvent.click(screen.getByLabelText('Тёмная'));
    expect(last().theme).toBe('dark');
    fireEvent.click(screen.getByLabelText('Светлая'));
    expect(last().theme).toBe('light');
  });
});

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
  it('lists all 30 keys grouped into major and minor with Russian names', () => {
    setup();
    const select = screen.getByLabelText('Тональность') as HTMLSelectElement;
    expect(select.querySelectorAll('option')).toHaveLength(30);
    const groups = select.querySelectorAll('optgroup');
    expect([...groups].map((g) => g.label)).toEqual(['Мажор', 'Минор']);
    expect(screen.getByRole('option', { name: 'Ре мажор' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'си минор' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ре-бемоль мажор' })).toBeInTheDocument();
  });

  it('propagates key changes', () => {
    const { last } = setup();
    fireEvent.change(screen.getByLabelText('Тональность'), { target: { value: 'D-major' } });
    expect(last().key).toEqual({ tonic: 'D', accidental: 0, mode: 'major' });
    fireEvent.change(screen.getByLabelText('Тональность'), { target: { value: 'Bb-minor' } });
    expect(last().key).toEqual({ tonic: 'B', accidental: -1, mode: 'minor' });
  });

  it('propagates clef changes and lists Russian clef names', () => {
    const { last } = setup();
    for (const name of ['скрипичный', 'скрипичный октавный', 'басовый', 'альтовый', 'теноровый']) {
      expect(screen.getByRole('option', { name })).toBeInTheDocument();
    }
    fireEvent.change(screen.getByLabelText('Ключ'), { target: { value: 'bass' } });
    expect(last().clef).toBe('bass');
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

  it('switches the UI language', () => {
    const { last } = setup();
    fireEvent.change(screen.getByLabelText('Язык'), { target: { value: 'en' } });
    expect(last().lang).toBe('en');
    expect(screen.getByLabelText('Key')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'D major' })).toBeInTheDocument();
  });
});

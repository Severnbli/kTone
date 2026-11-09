import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { KeySpec } from '../engine/types';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Lang } from '../i18n/strings';
import { KeyPicker } from './KeyPicker';

const C_MAJOR: KeySpec = { tonic: 'C', accidental: 0, mode: 'major' };

function setup(value = C_MAJOR, lang: Lang = 'ru') {
  const onChange = vi.fn<(k: KeySpec) => void>();
  render(
    <I18nProvider lang={lang}>
      <KeyPicker value={value} naming="solfege" onChange={onChange} />
    </I18nProvider>,
  );
  return onChange;
}

const cells = () =>
  within(screen.getByRole('group', { name: /^(Мажор|Минор)$/ })).getAllByRole('button');

describe('KeyPicker', () => {
  it('shows the 15 major keys ordered by signature, C major in the middle', () => {
    setup();
    const list = cells();
    expect(list).toHaveLength(15);
    expect(list[0]).toHaveAccessibleName('До-бемоль мажор');
    expect(list[0]).toHaveTextContent('7♭');
    expect(list[7]).toHaveAccessibleName('До мажор');
    expect(list[7]).toHaveTextContent('без знаков');
    expect(list[7]).toHaveAttribute('aria-pressed', 'true');
    expect(list[14]).toHaveAccessibleName('До-диез мажор');
    expect(list[14]).toHaveTextContent('7♯');
    expect(list.filter((b) => b.getAttribute('aria-pressed') === 'true')).toHaveLength(1);
  });

  it('switches to minor keys and picks one', () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole('radio', { name: 'Минор' }));
    const list = cells();
    expect(list).toHaveLength(15);
    expect(list[7]).toHaveAccessibleName('ля минор');
    expect(list.every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'си-бемоль минор' }));
    expect(onChange).toHaveBeenCalledWith({ tonic: 'B', accidental: -1, mode: 'minor' });
  });

  it('opens on the mode of the current key', () => {
    setup({ tonic: 'F', accidental: 1, mode: 'minor' });
    expect(screen.getByRole('radio', { name: 'Минор' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'фа-диез минор' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('uses English names', () => {
    const onChange = setup(C_MAJOR, 'en');
    fireEvent.click(screen.getByRole('button', { name: 'D major' }));
    expect(onChange).toHaveBeenCalledWith({ tonic: 'D', accidental: 0, mode: 'major' });
    expect(screen.getByRole('button', { name: 'G major' })).toHaveTextContent('1♯');
  });
});

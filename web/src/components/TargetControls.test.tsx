import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import type { ClefId, KeySpec } from '../engine/types';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Lang } from '../i18n/strings';
import type { NoteNaming } from '../music/naming';
import { DEFAULT_TARGET, type Target } from '../music/target';
import { frame } from '../test/frames';
import { TargetControls } from './TargetControls';

const C: KeySpec = { tonic: 'C', accidental: 0, mode: 'major' };

function setup({
  target = DEFAULT_TARGET,
  keySpec = C,
  clef = 'treble',
  naming = 'solfege',
  lang = 'ru',
  store,
}: {
  target?: Target;
  keySpec?: KeySpec;
  clef?: ClefId;
  naming?: NoteNaming;
  lang?: Lang;
  store?: PitchStore;
} = {}) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = useState(target);
    return (
      <I18nProvider lang={lang}>
        <TargetControls
          target={value}
          keySpec={keySpec}
          clef={clef}
          naming={naming}
          degreeStyle="roman"
          store={store}
          onChange={(t) => {
            onChange(t);
            setValue(t);
          }}
        />
      </I18nProvider>
    );
  }
  render(<Harness />);
  const open = screen.getByTestId('target-open');
  return { onChange, open, openSheet: () => fireEvent.click(open) };
}

describe('TargetControls', () => {
  it('the bottom-bar button says the target is off', () => {
    const { open } = setup();
    expect(open).toHaveAccessibleName('Цель: выключена');
    expect(open).toHaveTextContent('Цельвыкл.');
    expect(open).not.toHaveClass('on');
  });

  it('switching on picks the tonic in the clef octave and labels the button', () => {
    const { open, openSheet, onChange } = setup();
    openSheet();
    expect(screen.getByRole('dialog', { name: 'Целевая нота' })).toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: 'Петь к целевой ноте' });
    expect(toggle).toHaveFocus();
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: до первой октавы');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, degree: 1, octave: 4 });
    expect(open).toHaveClass('on');
    expect(open).toHaveAccessibleName('Цель: до первой октавы');
    expect(screen.getByTestId('target-open-note')).toHaveTextContent('до¹');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: false, degree: 1, octave: 4 });
  });

  it('a bass clef starts in the small octave', () => {
    const { openSheet } = setup({ clef: 'bass' });
    openSheet();
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: до малой октавы');
  });

  it('starts near the last sung note', () => {
    const store = new PitchStore();
    act(() => store.push(frame(69), 0)); // A4: C5 is closer than C4
    const { openSheet } = setup({ store });
    openSheet();
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: до второй октавы');
  });

  it('degrees are a radio group labelled with the degree and the note in the key', () => {
    const { openSheet, onChange } = setup({
      keySpec: { tonic: 'D', accidental: 0, mode: 'major' },
      target: { enabled: true, degree: 1, octave: 4 },
    });
    openSheet();
    const radios = screen.getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      'I · ре',
      'II · ми',
      'III · фа♯',
      'IV · соль',
      'V · ля',
      'VI · си',
      'VII · до♯',
    ]);
    expect(screen.getByRole('group', { name: 'Ступень' })).toContainElement(radios[0]);
    expect(radios[0]).toBeChecked();
    fireEvent.click(screen.getByLabelText('III · фа♯'));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, degree: 3, octave: 4 });
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: фа-диез первой октавы');
  });

  it('minor keys use the natural minor', () => {
    const { openSheet } = setup({ keySpec: { tonic: 'A', accidental: 0, mode: 'minor' } });
    openSheet();
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual([
      'I · ля',
      'II · си',
      'III · до',
      'IV · ре',
      'V · ми',
      'VI · фа',
      'VII · соль',
    ]);
  });

  it('picking a degree while off switches the target on, even the checked one', () => {
    const { openSheet, onChange } = setup();
    openSheet();
    fireEvent.click(screen.getByLabelText('I · до'));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, degree: 1, octave: 4 });
  });

  it('the octave stepper is limited to the voice range (E2–C6)', () => {
    const { openSheet, onChange } = setup({ target: { enabled: true, degree: 1, octave: 5 } });
    openSheet();
    const up = screen.getByRole('button', { name: 'Октава выше' });
    const down = screen.getByRole('button', { name: 'Октава ниже' });
    expect(screen.getByTestId('target-octave')).toHaveTextContent('второй октавы');
    fireEvent.click(up);
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, degree: 1, octave: 6 });
    expect(screen.getByTestId('target-preview')).toHaveTextContent('до третьей октавы');
    expect(up).toBeDisabled(); // C6 is the top
    fireEvent.click(down);
    fireEvent.click(down);
    fireEvent.click(down);
    expect(screen.getByTestId('target-octave')).toHaveTextContent('малой октавы');
    expect(down).toBeDisabled(); // C2 is below E2
    // III reaches lower: E2.
    fireEvent.click(screen.getByLabelText('III · ми'));
    expect(down).toBeEnabled();
    fireEvent.click(down);
    expect(screen.getByTestId('target-preview')).toHaveTextContent('ми большой октавы');
  });

  it('a degree that does not fit the octave is pulled into range', () => {
    const { openSheet, onChange } = setup({ target: { enabled: true, degree: 1, octave: 6 } });
    openSheet();
    fireEvent.click(screen.getByLabelText('VII · си'));
    expect(onChange).toHaveBeenLastCalledWith({ enabled: true, degree: 7, octave: 5 });
  });

  it('letter names: the octave is a number and the button says «E4»', () => {
    const { open, openSheet } = setup({
      naming: 'letter',
      target: { enabled: true, degree: 3, octave: 4 },
    });
    expect(screen.getByTestId('target-open-note')).toHaveTextContent('E4');
    expect(open).toHaveAccessibleName('Цель: E4');
    openSheet();
    expect(screen.getByTestId('target-octave')).toHaveTextContent('4');
    expect(screen.getByLabelText('III · E')).toBeChecked();
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: E4');
  });

  it('English', () => {
    const { open, openSheet } = setup({
      lang: 'en',
      naming: 'letter',
      target: { enabled: true, degree: 5, octave: 4 },
    });
    expect(open).toHaveAccessibleName('Target: G4');
    openSheet();
    expect(screen.getByRole('dialog', { name: 'Target note' })).toBeInTheDocument();
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Target: G4');
  });

  it('closes on Esc and gives the focus back to the button', () => {
    const { open, openSheet } = setup();
    open.focus();
    openSheet();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(open).toHaveFocus();
  });
});

import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Lang } from '../i18n/strings';
import type { DegreeStyle, NoteNaming } from '../music/naming';
import { frame } from '../test/frames';
import { NoteDisplay } from './NoteDisplay';

function setup(
  naming: NoteNaming = 'solfege',
  degreeStyle: DegreeStyle = 'roman',
  lang: Lang = 'ru',
) {
  const store = new PitchStore();
  render(
    <I18nProvider lang={lang}>
      <NoteDisplay store={store} naming={naming} degreeStyle={degreeStyle} hint="hint" />
    </I18nProvider>,
  );
  return store;
}

describe('NoteDisplay', () => {
  it('shows a placeholder and hint before any note', () => {
    setup();
    expect(screen.getByTestId('note-name')).toHaveTextContent('–');
    expect(screen.getByText('hint')).toBeInTheDocument();
  });

  it('shows solfège name, Russian octave, degree and frequency', () => {
    const store = setup();
    act(() => store.push(frame(69, 2), 0));
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
    expect(screen.getByTestId('note-octave')).toHaveTextContent('первой октавы');
    expect(screen.getByTestId('note-degree')).toHaveTextContent('Ступень VI');
    expect(screen.getByTestId('note-hz').textContent).toMatch(/^44\d\.\d$/);
    expect(screen.getByTestId('note-display')).not.toHaveClass('out-of-key');
  });

  it('letter names with octave number and arabic degrees', () => {
    const store = setup('letter', 'arabic', 'en');
    act(() =>
      store.push(frame(66, 0, { note: { letter: 'F', accidental: 1, octave: 4 }, degree: 3 }), 0),
    );
    expect(screen.getByTestId('note-name')).toHaveTextContent('F♯4');
    expect(screen.getByTestId('note-degree')).toHaveTextContent('Degree 3');
  });

  it('highlights out-of-key notes', () => {
    const store = setup();
    act(() =>
      store.push(
        frame(70, 0, {
          note: { letter: 'A', accidental: 1, octave: 4 },
          degree: null,
          inKey: false,
        }),
        0,
      ),
    );
    expect(screen.getByTestId('note-display')).toHaveClass('out-of-key');
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля♯');
    expect(screen.getByTestId('note-name')).toHaveAttribute('aria-label', 'ля-диез первой октавы');
    expect(screen.getByTestId('note-degree')).toHaveTextContent('вне тональности');
  });

  it('dims after silence but keeps the last note', () => {
    const store = setup();
    act(() => store.push(frame(69), 0));
    act(() => store.push(null, 1000));
    expect(screen.getByTestId('note-display')).toHaveClass('inactive');
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
    expect(screen.getByTestId('note-hz')).toHaveTextContent('–');
  });
});

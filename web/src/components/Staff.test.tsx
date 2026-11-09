import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import type { ClefId, SpelledNote } from '../engine/types';
import { staffStepFor } from '../music/theory';
import { frame } from '../test/frames';
import { Staff, StaffView } from './Staff';

function renderNote(note: SpelledNote | null, clef: ClefId, signature: number) {
  render(
    <StaffView
      clef={clef}
      signature={signature}
      note={note}
      staffStep={note ? staffStepFor(note, clef) : 0}
    />,
  );
}

const count = (id: string) => screen.queryAllByTestId(id).length;

describe('Staff', () => {
  it('draws the clef and no signature in C major', () => {
    renderNote(null, 'treble', 0);
    expect(screen.getByTestId('staff')).toHaveAttribute('data-clef', 'treble');
    expect(screen.getByTestId('clef')).toHaveTextContent('𝄞');
    expect(count('signature-accidental')).toBe(0);
    expect(count('note-head')).toBe(0);
  });

  it('draws key signature accidentals', () => {
    renderNote(null, 'bass', -5);
    const sig = screen.getAllByTestId('signature-accidental');
    expect(sig).toHaveLength(5);
    expect(sig.every((s) => s.textContent === '♭')).toBe(true);
  });

  it('draws 7 sharps in C♯ major on the tenor clef', () => {
    renderNote(null, 'tenor', 7);
    expect(screen.getAllByTestId('signature-accidental').map((s) => s.textContent)).toEqual(
      Array(7).fill('♯'),
    );
  });

  it('middle C on the treble staff needs one ledger line', () => {
    renderNote({ letter: 'C', accidental: 0, octave: 4 }, 'treble', 0);
    expect(count('note-head')).toBe(1);
    expect(count('ledger-line')).toBe(1);
    expect(count('note-accidental')).toBe(0);
  });

  it('A5 above the treble staff needs one ledger line, C6 two', () => {
    renderNote({ letter: 'A', accidental: 0, octave: 5 }, 'treble', 0);
    expect(count('ledger-line')).toBe(1);
  });

  it('C6 on treble needs two ledger lines', () => {
    renderNote({ letter: 'C', accidental: 0, octave: 6 }, 'treble', 0);
    expect(count('ledger-line')).toBe(2);
  });

  it('E2 on the bass staff needs one ledger line below', () => {
    renderNote({ letter: 'E', accidental: 0, octave: 2 }, 'bass', 0);
    expect(count('ledger-line')).toBe(1);
  });

  it('notes inside the staff need none', () => {
    renderNote({ letter: 'B', accidental: 0, octave: 4 }, 'treble', 0);
    expect(count('ledger-line')).toBe(0);
  });

  it('omits the accidental when the key signature already has it', () => {
    renderNote({ letter: 'F', accidental: 1, octave: 4 }, 'treble', 2);
    expect(count('note-accidental')).toBe(0);
  });

  it('shows the accidental when it differs from the signature', () => {
    renderNote({ letter: 'A', accidental: 1, octave: 4 }, 'treble', 2);
    expect(screen.getByTestId('note-accidental')).toHaveTextContent('♯');
  });

  it('shows a natural sign for a note the signature alters', () => {
    renderNote({ letter: 'F', accidental: 0, octave: 4 }, 'treble', 2);
    expect(screen.getByTestId('note-accidental')).toHaveTextContent('♮');
  });

  it('marks treble 8vb with an 8', () => {
    renderNote(null, 'treble8vb', 0);
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('live staff follows the store', () => {
    const store = new PitchStore();
    render(<Staff store={store} clef="treble" signature={0} />);
    expect(count('note-head')).toBe(0);
    act(() =>
      store.push(
        frame(60, 0, { note: { letter: 'C', accidental: 0, octave: 4 }, staffStep: -2 }),
        0,
      ),
    );
    expect(count('note-head')).toBe(1);
    expect(count('ledger-line')).toBe(1);
  });

  describe('target ghost note', () => {
    const headY = (id: string) => Number(screen.getByTestId(id).getAttribute('cy'));
    const headX = (id: string) => Number(screen.getByTestId(id).getAttribute('cx'));

    it('draws the target next to the sung note, at its own staff position', () => {
      const a4 = { letter: 'A', accidental: 0, octave: 4 } as const;
      render(
        <StaffView
          clef="treble"
          signature={0}
          note={a4}
          staffStep={staffStepFor(a4, 'treble')}
          target={{ letter: 'E', accidental: 0, octave: 4 }}
        />,
      );
      expect(count('target-head')).toBe(1);
      expect(count('note-head')).toBe(1);
      expect(headX('target-head')).toBeGreaterThan(headX('note-head') + 30);
      // E4 is the bottom line, A4 the second space: 3 steps of 5 px apart.
      expect(headY('target-head') - headY('note-head')).toBe(15);
      expect(screen.getByTestId('staff-target')).toHaveClass('staff-target');
    });

    it('shows the ghost alone before anything is sung, with ledger lines', () => {
      render(
        <StaffView
          clef="treble"
          signature={0}
          note={null}
          staffStep={0}
          target={{ letter: 'C', accidental: 0, octave: 4 }}
        />,
      );
      expect(count('note-head')).toBe(0);
      expect(count('target-head')).toBe(1);
      expect(count('target-ledger-line')).toBe(1);
    });

    it('prints the accidental the key signature does not cover', () => {
      render(
        <StaffView
          clef="bass"
          signature={0}
          note={null}
          staffStep={0}
          target={{ letter: 'F', accidental: 1, octave: 3 }}
        />,
      );
      expect(screen.getByTestId('target-accidental')).toHaveTextContent('♯');
    });

    it('a diatonic target needs no accidental in its key (D♭ major, V = A♭)', () => {
      render(
        <StaffView
          clef="treble"
          signature={-5}
          note={null}
          staffStep={0}
          target={{ letter: 'A', accidental: -1, octave: 4 }}
        />,
      );
      expect(count('target-accidental')).toBe(0);
    });

    it('live staff passes the target through', () => {
      const store = new PitchStore();
      render(
        <Staff
          store={store}
          clef="bass"
          signature={0}
          target={{ letter: 'G', accidental: 0, octave: 2 }}
        />,
      );
      expect(count('target-head')).toBe(1);
      expect(headY('target-head')).toBe(100); // bottom line
    });
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Sheet } from './Sheet';

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Тест">
        <button type="button">first</button>
        <button type="button" data-autofocus>
          picked
        </button>
        <button type="button">last</button>
      </Sheet>
    </>
  );
}

function openSheet() {
  render(<Harness />);
  const opener = screen.getByRole('button', { name: 'open' });
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole('dialog', { name: 'Тест' }) };
}

describe('Sheet', () => {
  it('is a labelled modal dialog that focuses the data-autofocus element', () => {
    const { dialog } = openSheet();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'picked' })).toHaveFocus();
  });

  it('closes with Esc and gives the focus back', () => {
    const { opener, dialog } = openSheet();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('closes on a tap outside and with the close button', () => {
    openSheet();
    fireEvent.click(screen.getByTestId('sheet-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('traps Tab inside the sheet', () => {
    const { dialog } = openSheet();
    const close = screen.getByRole('button', { name: 'Закрыть' });
    const last = screen.getByRole('button', { name: 'last' });
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });
});

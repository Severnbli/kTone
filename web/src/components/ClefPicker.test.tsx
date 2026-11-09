import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ClefId } from '../engine/types';
import { ClefPicker } from './ClefPicker';

describe('ClefPicker', () => {
  it('lists the five clefs with Russian names and marks the current one', () => {
    const onChange = vi.fn<(c: ClefId) => void>();
    render(<ClefPicker value="treble8vb" onChange={onChange} />);
    const names = ['скрипичный', 'скрипичный октавный', 'басовый', 'альтовый', 'теноровый'];
    expect(screen.getAllByRole('button').map((b) => b.textContent?.replace(/\P{L}/gu, ''))).toEqual(
      names.map((n) => n.replace(/\P{L}/gu, '')),
    );
    expect(screen.getByRole('button', { name: 'скрипичный октавный' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'теноровый' }));
    expect(onChange).toHaveBeenCalledWith('tenor');
  });
});

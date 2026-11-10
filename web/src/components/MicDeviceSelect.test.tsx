import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { announceMicPermission } from '../audio/devices';
import { audioInput, fakeMediaDevices, flush } from '../test/fakes';
import { MicDeviceSelect } from './MicDeviceSelect';

async function setup(value: string, md: ReturnType<typeof fakeMediaDevices> | null) {
  const onChange = vi.fn<(id: string) => void>();
  const utils = render(<MicDeviceSelect value={value} onChange={onChange} mediaDevices={md} />);
  await act(() => flush());
  return { onChange, ...utils };
}

const options = () =>
  screen.getAllByRole('option').map((o) => [(o as HTMLOptionElement).value, o.textContent]);

describe('MicDeviceSelect', () => {
  it('lists the system default and each input, numbering unnamed ones', async () => {
    const md = fakeMediaDevices([
      audioInput('default', 'Default'),
      audioInput('a', 'Built-in Microphone'),
      audioInput('b'),
    ]);
    const { onChange } = await setup('', md);
    expect(options()).toEqual([
      ['', 'Системный по умолчанию'],
      ['a', 'Built-in Microphone'],
      ['b', 'Микрофон 2'],
    ]);
    const select = screen.getByLabelText('Микрофон');
    expect(select).toHaveValue('');
    fireEvent.change(select, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('shows the saved device', async () => {
    await setup('a', fakeMediaDevices([audioInput('a', 'USB')]));
    expect(screen.getByLabelText('Микрофон')).toHaveValue('a');
    expect(screen.queryByText(/не найден/)).toBeNull();
  });

  it('falls back to the default when the saved device is gone', async () => {
    await setup('gone', fakeMediaDevices([audioInput('a', 'USB')]));
    expect(screen.getByLabelText('Микрофон')).toHaveValue('');
    expect(screen.getByText(/Выбранный микрофон не найден/)).toBeInTheDocument();
  });

  it('explains hidden names before permission', async () => {
    await setup('', fakeMediaDevices([audioInput('')]));
    expect(options()).toEqual([['', 'Системный по умолчанию']]);
    expect(screen.getByText(/после разрешения доступа/)).toBeInTheDocument();
  });

  it('refreshes on devicechange and stops listening on unmount', async () => {
    const md = fakeMediaDevices([audioInput('a', 'Built-in')]);
    const { unmount } = await setup('', md);
    expect(md.listeners).toBe(1);
    await act(async () => {
      md.plug([audioInput('a', 'Built-in'), audioInput('usb', 'USB Mic')]);
      await flush();
    });
    expect(options().map((o) => o[1])).toContain('USB Mic');
    unmount();
    expect(md.listeners).toBe(0);
  });

  it('refreshes once the microphone permission is granted, without devicechange', async () => {
    const md = fakeMediaDevices([audioInput('')]);
    const { unmount } = await setup('', md);
    expect(screen.getByText(/после разрешения доступа/)).toBeInTheDocument();
    // Granting the permission reveals the names; browsers fire no event.
    md.replace([audioInput('a', 'Built-in'), audioInput('usb', 'USB Mic')]);
    await act(async () => {
      announceMicPermission();
      await flush();
    });
    expect(options().map((o) => o[1])).toEqual(['Системный по умолчанию', 'Built-in', 'USB Mic']);
    expect(screen.queryByText(/после разрешения доступа/)).toBeNull();
    // No refresh after unmount.
    unmount();
    const calls = vi.mocked(md.enumerateDevices).mock.calls.length;
    announceMicPermission();
    expect(md.enumerateDevices).toHaveBeenCalledTimes(calls);
  });

  it('refreshes each time it is shown (the settings sheet mounts it on open)', async () => {
    const md = fakeMediaDevices([audioInput('')]);
    const { unmount } = await setup('', md);
    unmount();
    md.replace([audioInput('a', 'Built-in')]);
    await setup('', md);
    expect(options().map((o) => o[1])).toContain('Built-in');
  });

  it('renders nothing without mediaDevices', async () => {
    const { container } = await setup('', null);
    expect(container).toBeEmptyDOMElement();
  });
});

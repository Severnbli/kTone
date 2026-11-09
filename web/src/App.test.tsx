import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { BACKGROUND_STOP_MS } from './audio/lifecycle';
import { MicError } from './audio/mic';
import { createMockAnalyzer } from './engine/mock';
import { DEFAULT_SETTINGS, STORAGE_KEY } from './settings';
import {
  audioInput,
  fakeMediaDevices,
  fakeMic,
  fakeVisibility,
  fakeWakeLock,
  flush,
} from './test/fakes';

describe('App', () => {
  it('starts the mic, shows the sung note, and respells on key change', async () => {
    const mic = fakeMic();
    render(<App factory={createMockAnalyzer} startMic={mic.startMic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });

    act(() => mic.feed(440, 2048));
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
    expect(screen.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'green');
    expect(screen.getByTestId('level-meter')).toHaveAttribute('data-level', '-9');

    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    fireEvent.change(screen.getByLabelText('Тональность'), { target: { value: 'F-major' } });
    act(() => mic.feed(440 * Math.pow(2, 1 / 12), 2048));
    expect(screen.getByTestId('note-name')).toHaveTextContent('си♭');
    expect(screen.getByTestId('note-degree')).toHaveTextContent('IV');
    expect(screen.getByTestId('key-badge')).toHaveTextContent('Фа мажор');

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).key.tonic).toBe('F');

    fireEvent.click(screen.getByRole('button', { name: 'Стоп' }));
    await screen.findByRole('button', { name: 'Начать' });
    expect(screen.getByTestId('note-name')).toHaveTextContent('–');
  });

  it('ignores the drone in the mic unless the filter is off', async () => {
    const mic = fakeMic();
    render(<App factory={createMockAnalyzer} startMic={mic.startMic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });
    // jsdom has no AudioContext, so the drone is silent, but the app treats it as playing.
    fireEvent.click(screen.getByRole('button', { name: /Бурдон/ }));
    const c3 = 440 * 2 ** (-21 / 12);
    act(() => mic.feed(c3, 4096));
    expect(screen.getByTestId('note-name')).toHaveTextContent('–');

    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    fireEvent.click(screen.getByLabelText('Не принимать бурдон за голос'));
    act(() => mic.feed(c3, 2048));
    expect(screen.getByTestId('note-name')).toHaveTextContent('до');
  });

  it('restarts listening on the microphone chosen in settings and saves it', async () => {
    const mic = fakeMic();
    const md = fakeMediaDevices([audioInput('a', 'Built-in'), audioInput('usb', 'USB Mic')]);
    render(<App factory={createMockAnalyzer} startMic={mic.startMic} mediaDevices={md} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });
    expect(mic.startMic.mock.calls[0][1]?.deviceId).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    await screen.findByRole('option', { name: 'USB Mic' });
    fireEvent.change(screen.getByLabelText('Микрофон'), { target: { value: 'usb' } });
    await waitFor(() => expect(mic.startMic).toHaveBeenCalledTimes(2));
    expect(mic.startMic.mock.calls[1][1]?.deviceId).toBe('usb');
    expect(mic.stop).toHaveBeenCalledTimes(1);
    await flush();
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).micDeviceId).toBe('usb');

    act(() => mic.feed(440, 2048));
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
  });

  it('opens the saved microphone on start', async () => {
    const mic = fakeMic();
    render(
      <App
        factory={createMockAnalyzer}
        startMic={mic.startMic}
        mediaDevices={null}
        initialSettings={{ ...DEFAULT_SETTINGS, micDeviceId: 'usb' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });
    expect(mic.startMic.mock.calls[0][1]?.deviceId).toBe('usb');
  });

  it('reports a denied microphone', async () => {
    render(
      <App
        factory={createMockAnalyzer}
        startMic={async () => {
          throw new MicError('denied');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Нет доступа к микрофону');
    expect(screen.getByRole('button', { name: 'Начать' })).toBeEnabled();
  });

  it('reports a missing microphone', async () => {
    render(
      <App
        factory={createMockAnalyzer}
        startMic={async () => {
          throw new MicError('notFound');
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Микрофон не найден');
  });

  it('renders in English from saved settings', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, lang: 'en' }));
    render(<App factory={createMockAnalyzer} startMic={fakeMic().startMic} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument());
    expect(document.documentElement.lang).toBe('en');
  });

  describe('lifecycle', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function startApp() {
      const mic = fakeMic();
      const visibility = fakeVisibility();
      const lock = fakeWakeLock();
      render(
        <App
          factory={createMockAnalyzer}
          startMic={mic.startMic}
          visibility={visibility}
          wakeLock={lock.api}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
      await screen.findByRole('button', { name: 'Стоп' });
      await act(() => flush());
      return { mic, visibility, lock };
    }

    it('keeps the screen on while listening', async () => {
      const { lock } = await startApp();
      expect(lock.held()).toBe(1);
      fireEvent.click(screen.getByRole('button', { name: 'Стоп' }));
      await screen.findByRole('button', { name: 'Начать' });
      await act(() => flush());
      expect(lock.held()).toBe(0);
    });

    it('explains a lost microphone and offers Start again', async () => {
      const { mic, lock } = await startApp();
      act(() => mic.setState('ended'));
      expect(await screen.findByRole('alert')).toHaveTextContent('Микрофон отключился');
      expect(screen.getByRole('button', { name: 'Начать' })).toBeEnabled();
      await act(() => flush());
      expect(lock.held()).toBe(0);
    });

    it('shows a paused state with a Resume button when auto-resume fails', async () => {
      const { mic } = await startApp();
      mic.setResumeWorks(false);
      await act(async () => {
        mic.setState('suspended');
        await flush();
      });
      expect(screen.getByRole('alert')).toHaveTextContent('Пауза');
      expect(screen.getByRole('button', { name: 'Стоп' })).toBeInTheDocument();

      mic.setResumeWorks(true);
      fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(screen.queryByRole('button', { name: 'Продолжить' })).toBeNull();
      expect(mic.startMic).toHaveBeenCalledTimes(1);
    });

    it('stops listening after a long time in the background', async () => {
      const { visibility, mic } = await startApp();
      vi.useFakeTimers();
      act(() => visibility.set(true));
      await act(() => vi.advanceTimersByTimeAsync(BACKGROUND_STOP_MS));
      vi.useRealTimers();
      act(() => visibility.set(false));
      expect(await screen.findByRole('alert')).toHaveTextContent('в фоне');
      expect(screen.getByRole('button', { name: 'Начать' })).toBeInTheDocument();
      expect(mic.stop).toHaveBeenCalled();
    });
  });
});

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
  it('shows the debug overlay only with ?debug', async () => {
    const { unmount } = render(<App factory={createMockAnalyzer} startMic={fakeMic().startMic} />);
    expect(screen.queryByTestId('debug-overlay')).toBeNull();
    unmount();

    window.history.replaceState(null, '', '/?debug');
    try {
      const mic = fakeMic();
      render(<App factory={createMockAnalyzer} startMic={mic.startMic} />);
      const overlay = screen.getByTestId('debug-overlay');
      fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
      await screen.findByRole('button', { name: 'Стоп' });
      act(() => mic.feedSine(440, 2048 + 512));
      await waitFor(() => expect(overlay).toHaveTextContent('dropped 0 / 2 frames'));
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
  it('starts the mic, shows the sung note, and respells on key change', async () => {
    const mic = fakeMic();
    render(<App factory={createMockAnalyzer} startMic={mic.startMic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });

    act(() => mic.feed(440, 2048));
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
    // The zone shows once the center is ready: 6 frames of a straight tone.
    expect(screen.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'pending');
    act(() => mic.feedSine(440, 5 * 512));
    expect(screen.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'green');
    expect(screen.getByTestId('level-meter')).toHaveAttribute('data-level', '-9');

    fireEvent.click(screen.getByTestId('key-badge'));
    fireEvent.click(screen.getByRole('button', { name: 'Фа мажор' }));
    expect(screen.queryByRole('dialog')).toBeNull();
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
    fireEvent.click(screen.getByTestId('drone-open'));
    fireEvent.click(screen.getByTestId('drone-toggle'));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('drone-open')).toHaveAccessibleName(
      'Бурдон · до малой октавы, звучит',
    );
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

  it('changes the clef from the header chip', () => {
    render(<App factory={createMockAnalyzer} startMic={fakeMic().startMic} />);
    const chip = screen.getByTestId('clef-chip');
    expect(chip).toHaveAccessibleName('Ключ: скрипичный');
    fireEvent.click(chip);
    const dialog = screen.getByRole('dialog', { name: 'Ключ' });
    expect(screen.getByRole('button', { name: 'скрипичный' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'басовый' }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByTestId('staff')).toHaveAttribute('data-clef', 'bass');
    expect(chip).toHaveAccessibleName('Ключ: басовый');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).clef).toBe('bass');
  });

  it('opens settings in a sheet and gives the focus back on close', () => {
    render(<App factory={createMockAnalyzer} startMic={fakeMic().startMic} />);
    const gear = screen.getByRole('button', { name: 'Настройки' });
    gear.focus();
    fireEvent.click(gear);
    expect(gear).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Настройки' });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    for (const group of ['Звук', 'Нотация', 'Точность', 'Интерфейс']) {
      expect(screen.getByRole('heading', { name: group })).toBeInTheDocument();
    }
    // The live readout stays mounted behind the sheet.
    expect(screen.getByTestId('note-display')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(gear).toHaveFocus();
  });

  it('applies and saves the theme', () => {
    render(<App factory={createMockAnalyzer} startMic={fakeMic().startMic} />);
    expect(document.documentElement.dataset.theme).toBeUndefined();
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    fireEvent.click(screen.getByLabelText('Светлая'));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).theme).toBe('light');
    fireEvent.click(screen.getByLabelText('Как в системе'));
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('has a bottom bar with the drone, a round Start button and the target', () => {
    render(<App factory={createMockAnalyzer} startMic={fakeMic().startMic} />);
    const bar = screen.getByRole('contentinfo');
    expect(bar).toContainElement(screen.getByTestId('drone-open'));
    expect(bar).toContainElement(screen.getByTestId('start-stop'));
    expect(bar).toContainElement(screen.getByTestId('target-open'));
    expect(screen.getByTestId('start-stop')).toHaveTextContent('Начать');
    expect(screen.getByTestId('target-open')).toBeEnabled();
    expect(screen.getByRole('heading', { level: 1 })).toHaveAccessibleName('kTone');
  });

  it('measures from the target, keeps its degree on a key change and lets the drone play it', async () => {
    const mic = fakeMic();
    render(<App factory={createMockAnalyzer} startMic={mic.startMic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });
    act(() => mic.feed(440, 2048));
    expect(screen.getByTestId('cents-gauge')).toHaveAttribute('data-target', 'off');

    // Target V of C major: G, starting near the sung A4 → octave 4 (G4).
    fireEvent.click(screen.getByTestId('target-open'));
    fireEvent.click(screen.getByLabelText('V · соль'));
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: соль второй октавы');
    fireEvent.click(screen.getByRole('button', { name: 'Октава ниже' }));
    expect(screen.getByTestId('target-preview')).toHaveTextContent('Цель: соль первой октавы');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    act(() => mic.feed(440, 2048));
    const gauge = screen.getByTestId('cents-gauge');
    expect(gauge).toHaveAttribute('data-target', 'far');
    expect(screen.getByTestId('gauge-message')).toHaveTextContent('ниже на 2 полутона');
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
    expect(screen.getByTestId('note-target')).toHaveTextContent('Цель: соль первой октавы');
    expect(screen.getByTestId('target-head')).toBeInTheDocument();
    expect(screen.getByTestId('target-open')).toHaveAccessibleName('Цель: соль первой октавы');
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).target).toEqual({
      enabled: true,
      degree: 5,
      octave: 4,
    });

    // D major: V is A – the sung A4 is now a hit.
    fireEvent.click(screen.getByTestId('key-badge'));
    fireEvent.click(screen.getByRole('button', { name: 'Ре мажор' }));
    // A key change restarts the vibrato center: give it time to be ready.
    act(() => mic.feedSine(440, 8192));
    expect(screen.getByTestId('note-target')).toHaveTextContent('Цель: ля первой октавы');
    expect(gauge).toHaveAttribute('data-target', 'near');
    expect(gauge).toHaveAttribute('data-zone', 'green');

    // The drone plays the target (A4) when asked to.
    fireEvent.click(screen.getByTestId('drone-open'));
    fireEvent.click(screen.getByRole('switch', { name: 'Бурдон играет цель' }));
    fireEvent.click(screen.getByTestId('drone-toggle'));
    expect(screen.getByTestId('drone-open')).toHaveAccessibleName(
      'Бурдон · ля первой октавы, звучит',
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    // With the filter on, the A4 drone leaking into the mic is not taken for a voice.
    act(() => mic.feed(440, 4096));
    expect(gauge).toHaveAttribute('data-zone', 'none');

    // Switching the target off restores the nearest-semitone gauge.
    fireEvent.click(screen.getByTestId('target-open'));
    fireEvent.click(screen.getByRole('switch', { name: 'Петь к целевой ноте' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(gauge).toHaveAttribute('data-target', 'off');
    expect(screen.queryByTestId('note-target')).toBeNull();
    expect(screen.getByTestId('drone-open')).toHaveAccessibleName(
      'Бурдон · ре малой октавы, звучит',
    );
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

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { MicError } from './audio/mic';
import { createMockAnalyzer } from './engine/mock';
import { DEFAULT_SETTINGS, STORAGE_KEY } from './settings';

const SR = 48000;

function fakeMic() {
  let onBlock: ((b: Float32Array) => void) | null = null;
  const startMic = vi.fn(async (cb: (b: Float32Array) => void) => {
    onBlock = cb;
    return { sampleRate: SR, stop: async () => undefined };
  });
  let n = 0;
  const feed = (hz: number, samples: number) => {
    const block = new Float32Array(samples);
    for (let i = 0; i < samples; i++) block[i] = 0.5 * Math.sin((2 * Math.PI * hz * n++) / SR);
    onBlock?.(block);
  };
  return { startMic, feed };
}

describe('App', () => {
  it('starts the mic, shows the sung note, and respells on key change', async () => {
    const mic = fakeMic();
    render(<App factory={createMockAnalyzer} startMic={mic.startMic} />);
    fireEvent.click(screen.getByRole('button', { name: 'Начать' }));
    await screen.findByRole('button', { name: 'Стоп' });

    act(() => mic.feed(440, 2048));
    expect(screen.getByTestId('note-name')).toHaveTextContent('ля');
    expect(screen.getByTestId('cents-gauge')).toHaveAttribute('data-zone', 'green');

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
});

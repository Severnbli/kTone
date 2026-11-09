import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugStats } from '../audio/debugStats';
import { DEBUG_LOG_MS, DEBUG_REFRESH_MS, DebugOverlay } from './DebugOverlay';

describe('DebugOverlay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('shows the latest statistics and logs a summary while frames come in', () => {
    const stats = new DebugStats();
    stats.start(48000, 2048, 512, () => ({ baseLatency: 0.0107, outputLatency: 0.04 }));
    const log = vi.fn();
    render(<DebugOverlay stats={stats} log={log} />);
    const overlay = screen.getByTestId('debug-overlay');
    expect(overlay).toHaveTextContent('dropped 0 / 0 frames');

    stats.record(0.8, 0);
    stats.record(1.2, 1);
    act(() => vi.advanceTimersByTime(DEBUG_REFRESH_MS));
    expect(overlay).toHaveTextContent('analysis 1.00 / 1.20 ms (hop 10.7 ms)');
    expect(overlay).toHaveTextContent('dropped 1 / 2 frames');
    expect(overlay).toHaveTextContent('base 10.7 ms · output 40.0 ms');
    expect(overlay).toHaveTextContent('48000 Hz · 2048/512');

    act(() => vi.advanceTimersByTime(DEBUG_LOG_MS));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toMatch(/^kTone latency: analysis 1\.00 \/ 1\.20 ms/);
    // No new frames: no repeated log line.
    act(() => vi.advanceTimersByTime(DEBUG_LOG_MS));
    expect(log).toHaveBeenCalledTimes(1);
  });
});

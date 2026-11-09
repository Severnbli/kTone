import { useEffect, useState } from 'react';
import { formatSnapshot, type DebugSnapshot, type DebugStats } from '../audio/debugStats';

/** How often the overlay refreshes. */
export const DEBUG_REFRESH_MS = 500;
/** How often a summary line goes to the console. */
export const DEBUG_LOG_MS = 5000;

interface Props {
  stats: DebugStats;
  /** Defaults to `console.info`. */
  log?: (line: string) => void;
}

const consoleInfo = (line: string) => console.info(line);
const ms = (seconds: number | null) => (seconds === null ? 'n/a' : (seconds * 1000).toFixed(1));

/**
 * Developer overlay for `?debug`: per-frame analysis time, scheduler drops and
 * the AudioContext latency, refreshed twice a second and logged to the console
 * every 5 s while frames come in. Not localized: it is a diagnostic tool.
 */
export function DebugOverlay({ stats, log = consoleInfo }: Props) {
  const [snap, setSnap] = useState<DebugSnapshot>(() => stats.snapshot());

  useEffect(() => {
    let lastLogged = -1;
    let sinceLog = 0;
    const id = setInterval(() => {
      const next = stats.snapshot();
      setSnap(next);
      sinceLog += DEBUG_REFRESH_MS;
      if (sinceLog >= DEBUG_LOG_MS && next.frames !== lastLogged) {
        sinceLog = 0;
        lastLogged = next.frames;
        log(formatSnapshot(next));
      }
    }, DEBUG_REFRESH_MS);
    return () => clearInterval(id);
  }, [stats, log]);

  const hopMs = snap.sampleRate > 0 ? (snap.hopSize / snap.sampleRate) * 1000 : 0;
  return (
    <aside className="debug-overlay" data-testid="debug-overlay" aria-label="Debug">
      <div>
        analysis {snap.analysisMeanMs.toFixed(2)} / {snap.analysisMaxMs.toFixed(2)} ms
        {hopMs > 0 && ` (hop ${hopMs.toFixed(1)} ms)`}
      </div>
      <div>
        dropped {snap.dropped} / {snap.frames} frames
      </div>
      <div>
        base {ms(snap.latency.baseLatency)} ms · output {ms(snap.latency.outputLatency)} ms
      </div>
      {snap.sampleRate > 0 && (
        <div>
          {snap.sampleRate} Hz · {snap.frameSize}/{snap.hopSize}
        </div>
      )}
    </aside>
  );
}

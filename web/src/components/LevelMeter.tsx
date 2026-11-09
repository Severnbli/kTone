import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ANALYZER_GATE_DBFS,
  CLIP_PEAK,
  METER_MIN_DBFS,
  meterPercent,
  type LevelStore,
} from '../audio/level';
import { useI18n } from '../i18n/context';

interface Props {
  levels: LevelStore;
  /** Where the analyzer starts listening; a calibrated value can be passed later. */
  gateDbfs?: number;
}

/**
 * Compact input level bar (RMS, −70..0 dBFS) with a marker at the analyzer
 * gate, plus the "too quiet" / "too loud" hint. The bar is updated
 * imperatively on every frame; React re-renders only when the hint changes.
 */
export function LevelMeter({ levels, gateDbfs = ANALYZER_GATE_DBFS }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const hint = useSyncExternalStore(levels.subscribeHint, levels.getHint);

  useEffect(() => {
    const apply = () => {
      const root = rootRef.current;
      const fill = fillRef.current;
      if (!root || !fill) return;
      const { rmsDb, peak } = levels.level;
      const db = Number.isFinite(rmsDb) ? Math.max(METER_MIN_DBFS, Math.round(rmsDb)) : null;
      fill.style.width = `${meterPercent(rmsDb)}%`;
      root.dataset.state =
        db === null ? 'off' : peak >= CLIP_PEAK ? 'clip' : rmsDb < gateDbfs ? 'low' : 'ok';
      root.dataset.level = db === null ? '' : String(db);
      root.setAttribute('aria-valuenow', String(db ?? METER_MIN_DBFS));
      root.setAttribute('aria-valuetext', db === null ? '–' : `${db} dBFS`);
    };
    apply();
    return levels.subscribeLevel(apply);
  }, [levels, gateDbfs]);

  return (
    <div className="level">
      <div
        ref={rootRef}
        className="level-meter"
        data-testid="level-meter"
        data-state="off"
        data-level=""
        role="meter"
        aria-label={t.inputLevel}
        aria-valuemin={METER_MIN_DBFS}
        aria-valuemax={0}
        aria-valuenow={METER_MIN_DBFS}
      >
        <div ref={fillRef} className="level-fill" data-testid="level-fill" />
        <div
          className="level-gate"
          data-testid="level-gate"
          title={t.levelGate}
          style={{ left: `${meterPercent(gateDbfs)}%` }}
        />
      </div>
      {hint !== 'none' && (
        <p className="level-hint" role="status" data-testid="level-hint" data-hint={hint}>
          {hint === 'quiet' ? t.tooQuiet : t.tooLoud}
        </p>
      )}
    </div>
  );
}

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { CLIP_PEAK, METER_MIN_DBFS, meterPercent, type LevelStore } from '../audio/level';
import { useI18n } from '../i18n/context';
import { InfoIcon, MicIcon } from './icons';

interface Props {
  levels: LevelStore;
  /** Where the too quiet / too loud hint goes (the toast area); inline when absent. */
  hintHost?: HTMLElement | null;
}

const HINT_TEXT = { quiet: 'tooQuiet', loud: 'tooLoud', noisy: 'noisyRoom' } as const;

/**
 * Compact, labelled input level bar (RMS, −70..0 dBFS) with a marker at the
 * analyzer's live gate and a subtle band up to its measured noise floor
 * (explained by the info button and `aria-describedby`), plus the
 * "too quiet" / "too loud" / "noisy room" hint. The bar, marker and band are
 * updated imperatively on every frame; React re-renders only when the hint
 * changes.
 */
export function LevelMeter({ levels, hintHost }: Props) {
  const { t } = useI18n();
  const helpId = useId();
  const [showHelp, setShowHelp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const gateRef = useRef<HTMLDivElement>(null);
  const floorRef = useRef<HTMLDivElement>(null);
  const hint = useSyncExternalStore(levels.subscribeHint, levels.getHint);

  useEffect(() => {
    const apply = () => {
      const root = rootRef.current;
      const fill = fillRef.current;
      const gate = gateRef.current;
      const floor = floorRef.current;
      if (!root || !fill || !gate || !floor) return;
      const { rmsDb, peak, gateDb, floorDb } = levels.level;
      const db = Number.isFinite(rmsDb) ? Math.max(METER_MIN_DBFS, Math.round(rmsDb)) : null;
      fill.style.width = `${meterPercent(rmsDb)}%`;
      gate.hidden = gateDb === null;
      if (gateDb !== null) gate.style.left = `${meterPercent(gateDb)}%`;
      floor.hidden = floorDb === null;
      if (floorDb !== null) floor.style.width = `${meterPercent(floorDb)}%`;
      root.dataset.gate = gateDb === null ? '' : gateDb.toFixed(1);
      root.dataset.floor = floorDb === null ? '' : floorDb.toFixed(1);
      root.dataset.state =
        db === null
          ? 'off'
          : peak >= CLIP_PEAK
            ? 'clip'
            : gateDb !== null && rmsDb < gateDb
              ? 'low'
              : 'ok';
      root.dataset.level = db === null ? '' : String(db);
      root.setAttribute('aria-valuenow', String(db ?? METER_MIN_DBFS));
      root.setAttribute('aria-valuetext', db === null ? '–' : `${db} dBFS`);
    };
    apply();
    return levels.subscribeLevel(apply);
  }, [levels]);

  const hintEl =
    hint === 'none' ? null : (
      <p className="toast level-hint" role="status" data-testid="level-hint" data-hint={hint}>
        {t[HINT_TEXT[hint]]}
      </p>
    );

  return (
    <div className="level">
      <span className="level-label" aria-hidden="true">
        <MicIcon />
        {t.inputLevel}
      </span>
      <div
        ref={rootRef}
        className="level-meter"
        data-testid="level-meter"
        data-state="off"
        data-level=""
        data-gate=""
        data-floor=""
        role="meter"
        aria-label={t.inputLevel}
        aria-describedby={helpId}
        aria-valuemin={METER_MIN_DBFS}
        aria-valuemax={0}
        aria-valuenow={METER_MIN_DBFS}
      >
        <div
          ref={floorRef}
          className="level-floor"
          data-testid="level-floor"
          title={t.levelFloor}
          hidden
        />
        <div ref={fillRef} className="level-fill" data-testid="level-fill" />
        <div
          ref={gateRef}
          className="level-gate"
          data-testid="level-gate"
          title={t.levelGate}
          hidden
        />
      </div>
      <button
        type="button"
        className="level-info"
        aria-label={t.levelHelp}
        aria-expanded={showHelp}
        aria-controls={helpId}
        onClick={() => setShowHelp((v) => !v)}
        onBlur={() => setShowHelp(false)}
      >
        <InfoIcon />
      </button>
      <p id={helpId} className="level-help" hidden={!showHelp}>
        {t.levelGateHelp} {t.levelFloorHelp}
      </p>
      {hintEl && (hintHost ? createPortal(hintEl, hintHost) : hintEl)}
    </div>
  );
}

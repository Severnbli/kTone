import { useEffect, useRef } from 'react';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { GAUGE_RANGE as RANGE, classifyCents, needlePercent, type ZoneThresholds } from '../zones';

interface Props {
  store: PitchStore;
  zones: ZoneThresholds;
}

/**
 * ±50 cent gauge. Updated imperatively on every analyzer frame (no React
 * re-render): the root's `data-zone`, the needle position and the readout.
 */
export function CentsGauge({ store, zones }: Props) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const apply = () => {
      const frame = store.latest;
      const root = rootRef.current;
      const needle = needleRef.current;
      const readout = readoutRef.current;
      if (!root || !needle || !readout) return;
      if (!frame) {
        root.dataset.zone = 'none';
        root.setAttribute('aria-valuetext', '–');
        readout.textContent = '–';
        return;
      }
      const zone = classifyCents(frame.cents, zones);
      const rounded = Math.round(frame.cents);
      root.dataset.zone = zone;
      root.setAttribute('aria-valuenow', String(rounded));
      root.setAttribute('aria-valuetext', `${rounded} ${t.cents}`);
      needle.style.left = `${needlePercent(frame.cents)}%`;
      readout.textContent = `${rounded > 0 ? '+' : ''}${rounded}`;
    };
    apply();
    return store.subscribeFrame(apply);
  }, [store, zones, t]);

  const greenW = (zones.green / RANGE) * 50;
  const yellowW = (zones.yellow / RANGE) * 50;

  return (
    <div
      ref={rootRef}
      className="gauge"
      data-testid="cents-gauge"
      data-zone="none"
      role="meter"
      aria-label={t.gauge}
      aria-valuemin={-RANGE}
      aria-valuemax={RANGE}
      aria-valuenow={0}
    >
      <div className="gauge-track">
        <div
          className="gauge-band yellow"
          style={{ left: `${50 - yellowW}%`, width: `${2 * yellowW}%` }}
        />
        <div
          className="gauge-band green"
          style={{ left: `${50 - greenW}%`, width: `${2 * greenW}%` }}
        />
        <div className="gauge-center" />
        <div ref={needleRef} className="gauge-needle" data-testid="gauge-needle" />
      </div>
      <div className="gauge-labels">
        <span>−50 · {t.flat}</span>
        <span className="gauge-readout">
          <span ref={readoutRef} data-testid="gauge-readout">
            –
          </span>{' '}
          {t.cents}
        </span>
        <span>{t.sharp} · +50</span>
      </div>
    </div>
  );
}

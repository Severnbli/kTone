import { useEffect, useRef } from 'react';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { GAUGE_RANGE as RANGE, classifyCents, needlePercent, type ZoneThresholds } from '../zones';

interface Props {
  store: PitchStore;
  zones: ZoneThresholds;
}

/** Minimum distance between scale labels, in cents (about 30 px on a phone). */
const LABEL_GAP = 9;

/** Scale labels by priority (center, ends, zone edges), dropping those that would collide. */
function scaleLabels(zones: ZoneThresholds): number[] {
  const kept: number[] = [];
  for (const c of [0, -RANGE, RANGE, -zones.yellow, zones.yellow, -zones.green, zones.green]) {
    if (kept.every((k) => Math.abs(k - c) >= LABEL_GAP)) kept.push(c);
  }
  return kept;
}

/**
 * ±50 cent gauge. Updated imperatively on every analyzer frame (no React
 * re-render): the root's `data-zone` and `data-dir`, the needle position and
 * the readout. All of them follow the vibrato center (`centerCents`), so
 * vibrato around the target reads as a hit and the needle stays calm.
 *
 * Accuracy is never shown by color alone: the needle position, tick marks at
 * the zone edges, a check mark on a hit and the «ниже» / «выше» side label
 * that lights up when the center is off carry the same information.
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
        root.dataset.dir = 'none';
        root.setAttribute('aria-valuetext', '–');
        readout.textContent = '–';
        return;
      }
      const cents = frame.centerCents;
      const zone = classifyCents(cents, zones);
      const rounded = Math.round(cents);
      root.dataset.zone = zone;
      root.dataset.dir = zone === 'green' ? 'in' : cents < 0 ? 'flat' : 'sharp';
      root.setAttribute('aria-valuenow', String(rounded));
      root.setAttribute('aria-valuetext', `${rounded} ${t.cents}`);
      needle.style.left = `${needlePercent(cents)}%`;
      readout.textContent = `${rounded > 0 ? '+' : ''}${rounded}`;
    };
    apply();
    return store.subscribeFrame(apply);
  }, [store, zones, t]);

  const greenW = (zones.green / RANGE) * 50;
  const yellowW = (zones.yellow / RANGE) * 50;
  const ticks = [-zones.yellow, -zones.green, zones.green, zones.yellow];

  return (
    <div
      ref={rootRef}
      className="gauge"
      data-testid="cents-gauge"
      data-zone="none"
      data-dir="none"
      role="meter"
      aria-label={t.gauge}
      aria-valuemin={-RANGE}
      aria-valuemax={RANGE}
      aria-valuenow={0}
    >
      <div className="gauge-head">
        <span className="gauge-side flat" aria-hidden="true">
          <span className="gauge-arrow">▼</span> {t.flat}
        </span>
        <span className="gauge-readout">
          <span ref={readoutRef} className="gauge-value" data-testid="gauge-readout">
            –
          </span>
          <span className="gauge-unit">{t.cents}</span>
        </span>
        <span className="gauge-side sharp" aria-hidden="true">
          {t.sharp} <span className="gauge-arrow">▲</span>
        </span>
      </div>
      <div className="gauge-track">
        <div
          className="gauge-band yellow"
          style={{ left: `${50 - yellowW}%`, width: `${2 * yellowW}%` }}
        />
        <div
          className="gauge-band green"
          style={{ left: `${50 - greenW}%`, width: `${2 * greenW}%` }}
        />
        {ticks.map((c, i) => (
          <div key={i} className="gauge-tick" style={{ left: `${needlePercent(c)}%` }} />
        ))}
        <div className="gauge-center" />
        <div ref={needleRef} className="gauge-needle" data-testid="gauge-needle" />
      </div>
      <div className="gauge-scale" aria-hidden="true">
        {scaleLabels(zones).map((c) => (
          <span key={c} style={{ left: `${needlePercent(c)}%` }}>
            {c > 0 ? `+${c}` : c < 0 ? `−${-c}` : '0'}
          </span>
        ))}
      </div>
    </div>
  );
}

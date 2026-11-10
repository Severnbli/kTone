import { useEffect, useRef } from 'react';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { assessTarget, targetMessage } from '../music/target';
import { GAUGE_RANGE as RANGE, classifyCents, needlePercent, type ZoneThresholds } from '../zones';

interface Props {
  store: PitchStore;
  zones: ZoneThresholds;
  /** MIDI number of the target note; null: measure from the nearest semitone. */
  targetMidi?: number | null;
}

/** A direction message is announced once it has held this long (not every frame). */
export const ANNOUNCE_DELAY_MS = 700;

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
 * vibrato around the target reads as a hit and the needle stays calm. Until
 * the center of a new note is ready (`centerReady`), the zone is `pending`:
 * neutral, so a vibrato onset never flashes red.
 *
 * Accuracy is never shown by color alone: the needle position, tick marks at
 * the zone edges, a check mark on a hit and the «ниже» / «выше» side label
 * that lights up when the center is off carry the same information.
 *
 * With a target (`targetMidi`) the deviation is the center's distance from the
 * target. Within half a semitone it reads as usual; further away the needle is
 * pinned to the edge and a message says where to go («выше на 2 полутона») or
 * that the octave is wrong (`data-target`: `near` / `far` / `octave`). The
 * message reaches screen readers only once it has held for ANNOUNCE_DELAY_MS.
 */
export function CentsGauge({ store, zones, targetMidi = null }: Props) {
  const { t, lang } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const needleRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const messageRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let shown = '';
    let pending = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const announce = (text: string) => {
      if (text === pending) return;
      pending = text;
      clearTimeout(timer);
      if (text === shown) return;
      timer = setTimeout(() => {
        shown = text;
        if (liveRef.current) liveRef.current.textContent = text;
      }, ANNOUNCE_DELAY_MS);
    };
    const apply = () => {
      const frame = store.latest;
      const root = rootRef.current;
      const needle = needleRef.current;
      const readout = readoutRef.current;
      const message = messageRef.current;
      if (!root || !needle || !readout || !message) return;
      root.dataset.target = targetMidi === null ? 'off' : 'none';
      if (!frame) {
        root.dataset.zone = 'none';
        root.dataset.dir = 'none';
        root.setAttribute('aria-valuetext', '–');
        readout.textContent = '–';
        message.textContent = '';
        announce('');
        return;
      }
      const reading =
        targetMidi === null ? null : assessTarget(frame.centerMidi, targetMidi, zones);
      const cents = reading ? reading.cents : frame.centerCents;
      const text = reading ? targetMessage(reading, t, lang) : '';
      const rounded = Math.round(cents);
      if (reading) root.dataset.target = reading.state;
      // Away from the target the direction is clear at once; fine accuracy waits for the center.
      if (frame.centerReady || (reading && reading.state !== 'near')) {
        const zone = reading ? reading.zone : classifyCents(cents, zones);
        root.dataset.zone = zone;
        root.dataset.dir = zone === 'green' ? 'in' : cents < 0 ? 'flat' : 'sharp';
      } else {
        // The center is still too young to judge: the needle moves, but
        // no zone color, hit mark or side label yet.
        root.dataset.zone = 'pending';
        root.dataset.dir = 'none';
      }
      root.setAttribute('aria-valuenow', String(Math.max(-RANGE, Math.min(RANGE, rounded))));
      root.setAttribute('aria-valuetext', text || `${rounded} ${t.cents}`);
      needle.style.left = `${needlePercent(cents)}%`;
      readout.textContent = `${rounded > 0 ? '+' : ''}${rounded}`;
      message.textContent = text;
      announce(text);
    };
    apply();
    const unsubscribe = store.subscribeFrame(apply);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [store, zones, t, lang, targetMidi]);

  const greenW = (zones.green / RANGE) * 50;
  const yellowW = (zones.yellow / RANGE) * 50;
  const ticks = [-zones.yellow, -zones.green, zones.green, zones.yellow];

  // The live region sits outside the meter: a meter's children are presentational.
  return (
    <>
      <div
        ref={rootRef}
        className="gauge"
        data-testid="cents-gauge"
        data-zone="none"
        data-dir="none"
        data-target="off"
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
          <span ref={messageRef} className="gauge-message" data-testid="gauge-message" />
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
      <span ref={liveRef} className="visually-hidden" aria-live="polite" data-testid="gauge-live" />
    </>
  );
}

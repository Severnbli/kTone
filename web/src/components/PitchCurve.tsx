import { useEffect, useRef } from 'react';
import type { KeySpec } from '../engine/types';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { pitchName, type NoteNaming } from '../music/naming';
import { mod, scaleOf } from '../music/theory';
import { classifyCents, type Zone, type ZoneThresholds } from '../zones';

const WINDOW_MS = 8000;
const HALF_RANGE = 7; // semitones above and below the view center
const LABEL_W = 34;
/** Gaps longer than this break the line. */
const MAX_GAP_MS = 120;

interface Props {
  store: PitchStore;
  keySpec: KeySpec;
  naming: NoteNaming;
  zones: ZoneThresholds;
}

interface Palette {
  grid: string;
  tonic: string;
  text: string;
  band: string;
  zones: Record<Zone, string>;
}

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    grid: v('--curve-grid', '#8884'),
    tonic: v('--curve-tonic', '#888a'),
    text: v('--muted', '#888'),
    band: v('--curve-band', '#22a55926'),
    zones: {
      green: v('--zone-green', '#22a559'),
      yellow: v('--zone-yellow', '#e0a800'),
      red: v('--zone-red', '#e5484d'),
    },
  };
}

/**
 * Scrolling pitch curve drawn on a canvas from `store.history` in a
 * requestAnimationFrame loop. Never triggers React renders per frame.
 */
export function PitchCurve({ store, keySpec, naming, zones }: Props) {
  const { t, lang } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const scale = scaleOf(keySpec);
    const labels = scale.map((n) => pitchName(n, naming, lang));
    let palette = readPalette(canvas);
    let width = 0;
    let height = 0;
    let center = NaN;
    let raf = 0;
    let lastHead = -1;
    let dirty = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      palette = readPalette(canvas);
      dirty = true;
    };
    resize();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onScheme = () => {
      palette = readPalette(canvas);
      dirty = true;
    };
    mq?.addEventListener?.('change', onScheme);

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const h = store.history;
      if (h.head === lastHead && !dirty) return;
      lastHead = h.head;
      dirty = false;

      const newest = h.size > 0 ? h.time[h.at(h.size - 1)] : 0;
      const latest = store.latest;
      // Follow the stable note smoothly; keep the last center through silence.
      const target = latest ? latest.stableMidi : center;
      if (Number.isFinite(target)) {
        center = Number.isFinite(center) ? center + (target - center) * 0.08 : target;
      }
      const c = Number.isFinite(center) ? center : 69;
      const plotW = width - LABEL_W;
      const yOf = (midi: number) => height / 2 - ((midi - c) / HALF_RANGE) * (height / 2);
      const xOf = (time: number) => LABEL_W + plotW - ((newest - time) / WINDOW_MS) * plotW;

      ctx.clearRect(0, 0, width, height);

      // Key note grid with labels.
      ctx.font = '11px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      for (let m = Math.floor(c - HALF_RANGE); m <= Math.ceil(c + HALF_RANGE); m++) {
        const deg = scale.findIndex((n) => n.pc === mod(m, 12));
        if (deg < 0) continue;
        const yy = yOf(m);
        ctx.strokeStyle = deg === 0 ? palette.tonic : palette.grid;
        ctx.lineWidth = deg === 0 ? 1.5 : 1;
        ctx.beginPath();
        ctx.moveTo(LABEL_W, yy);
        ctx.lineTo(width, yy);
        ctx.stroke();
        ctx.fillStyle = palette.text;
        ctx.fillText(labels[deg], 2, yy);
      }

      // Target band around the current stable note.
      if (latest) {
        const top = yOf(latest.stableMidi + zones.green / 100);
        const bottom = yOf(latest.stableMidi - zones.green / 100);
        ctx.fillStyle = palette.band;
        ctx.fillRect(LABEL_W, top, plotW, bottom - top);
      }

      // Raw pitch line (vibrato stays visible), colored by the accuracy of the
      // vibrato center relative to the stable note.
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      let prevX = NaN;
      let prevY = NaN;
      let prevT = NaN;
      for (let i = 0; i < h.size; i++) {
        const idx = h.at(i);
        const time = h.time[idx];
        if (newest - time > WINDOW_MS) continue;
        const midi = h.midi[idx];
        if (!Number.isFinite(midi)) {
          prevX = NaN;
          continue;
        }
        const xx = xOf(time);
        const yy = yOf(midi);
        if (Number.isFinite(prevX) && time - prevT <= MAX_GAP_MS) {
          const zone = classifyCents(h.centerCents[idx], zones);
          ctx.strokeStyle = palette.zones[zone];
          ctx.beginPath();
          ctx.moveTo(prevX, prevY);
          ctx.lineTo(xx, yy);
          ctx.stroke();
        }
        prevX = xx;
        prevY = yy;
        prevT = time;
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      mq?.removeEventListener?.('change', onScheme);
    };
  }, [store, keySpec, naming, lang, zones]);

  return (
    <canvas
      ref={canvasRef}
      className="pitch-curve"
      data-testid="pitch-curve"
      role="img"
      aria-label={t.pitchCurve}
    />
  );
}

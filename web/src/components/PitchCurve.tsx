import { useEffect, useRef } from 'react';
import type { KeySpec } from '../engine/types';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { pitchName, type NoteNaming } from '../music/naming';
import { mod, scaleOf } from '../music/theory';
import { ZONE_COLORS, classifyCents, type Zone, type ZoneThresholds } from '../zones';

const WINDOW_MS = 8000;
const HALF_RANGE = 7; // semitones above and below the view center
const LABEL_W = 40;
const FONT_PX = 11;
/** Minimum vertical distance between two note labels. */
const LABEL_GAP = FONT_PX + 5;
/** Label priority by scale degree index: tonic, dominant, mediant, the rest. */
const LABEL_PRIORITY = [0, 3, 2, 3, 1, 3, 3];
/** Gaps longer than this break the line. */
const MAX_GAP_MS = 120;
/** Line color while the center of a new note is not ready (fallback for `--muted`). */
export const PENDING_COLOR = '#8a8f98';

interface Props {
  store: PitchStore;
  keySpec: KeySpec;
  naming: NoteNaming;
  zones: ZoneThresholds;
}

/** A zone, or `pending`: the center of the note is too young to judge. */
type Shade = Zone | 'pending';

interface Palette {
  grid: string;
  tonic: string;
  tonicText: string;
  text: string;
  band: string;
  /** Line colors: the zones, and `pending` while the center is not ready. */
  zones: Record<Shade, string>;
}

function readPalette(el: HTMLElement): Palette {
  const css = getComputedStyle(el);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    grid: v('--curve-grid', '#8884'),
    tonic: v('--curve-tonic', '#888a'),
    tonicText: v('--curve-tonic-text', '#888'),
    text: v('--muted', '#888'),
    band: v('--curve-band', '#22a55926'),
    zones: {
      green: v('--zone-green', ZONE_COLORS.green),
      yellow: v('--zone-yellow', ZONE_COLORS.yellow),
      red: v('--zone-red', ZONE_COLORS.red),
      pending: v('--muted', PENDING_COLOR),
    },
  };
}

interface Label {
  y: number;
  deg: number;
}

/**
 * Note labels that fit: inside the canvas and at least LABEL_GAP apart, placed
 * by priority (the tonic always wins), so «ми» and «фа» never overlap.
 */
function placeLabels(candidates: Label[], height: number, out: Label[]): Label[] {
  out.length = 0;
  candidates.sort((a, b) => LABEL_PRIORITY[a.deg] - LABEL_PRIORITY[b.deg]);
  for (const c of candidates) {
    if (c.y < FONT_PX / 2 + 1 || c.y > height - FONT_PX / 2 - 1) continue;
    if (out.every((p) => Math.abs(p.y - c.y) >= LABEL_GAP)) out.push(c);
  }
  return out;
}

/**
 * Scrolling pitch curve drawn on a canvas from `store.history` in a
 * requestAnimationFrame loop. Never triggers React renders per frame.
 *
 * The line is drawn in runs of one zone color: each run is stroked twice,
 * first wide and translucent (the "neon" glow), then thin and solid. This is
 * far cheaper than `shadowBlur` and keeps the stroke count low.
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
    // The manual theme switch sets `data-theme` on <html>.
    const themeObserver =
      typeof MutationObserver !== 'undefined' ? new MutationObserver(onScheme) : null;
    themeObserver?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const candidates: Label[] = [];
    const placed: Label[] = [];

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

      // Key note grid; labels only where they fit, the tonic emphasized.
      candidates.length = 0;
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
        candidates.push({ y: yy, deg });
      }
      ctx.textBaseline = 'middle';
      for (const l of placeLabels(candidates, height, placed)) {
        ctx.font = `${l.deg === 0 ? 700 : 400} ${FONT_PX}px system-ui, sans-serif`;
        ctx.fillStyle = l.deg === 0 ? palette.tonicText : palette.text;
        ctx.fillText(labels[l.deg], 4, l.y);
      }

      // Target band around the current stable note.
      if (latest) {
        const top = yOf(latest.stableMidi + zones.green / 100);
        const bottom = yOf(latest.stableMidi - zones.green / 100);
        ctx.fillStyle = palette.band;
        ctx.fillRect(LABEL_W, top, plotW, bottom - top);
      }

      // Raw pitch line (vibrato stays visible), colored by the accuracy of the
      // vibrato center relative to the stable note, in runs of one color;
      // neutral until the center of a new note is ready.
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      let runZone: Shade | null = null;
      let headX = NaN;
      let headY = NaN;
      let headZone: Shade = 'green';
      const strokeRun = () => {
        if (runZone === null) return;
        ctx.strokeStyle = palette.zones[runZone];
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        runZone = null;
      };
      let prevX = NaN;
      let prevY = NaN;
      let prevT = NaN;
      for (let i = 0; i < h.size; i++) {
        const idx = h.at(i);
        const time = h.time[idx];
        if (newest - time > WINDOW_MS) continue;
        const midi = h.midi[idx];
        if (!Number.isFinite(midi)) {
          strokeRun();
          prevX = NaN;
          continue;
        }
        const xx = xOf(time);
        const yy = yOf(midi);
        if (Number.isFinite(prevX) && time - prevT <= MAX_GAP_MS) {
          const zone: Shade = h.centerReady[idx]
            ? classifyCents(h.centerCents[idx], zones)
            : 'pending';
          if (zone !== runZone) {
            strokeRun();
            runZone = zone;
            ctx.beginPath();
            ctx.moveTo(prevX, prevY);
          }
          ctx.lineTo(xx, yy);
          headX = xx;
          headY = yy;
          headZone = zone;
        } else {
          strokeRun();
        }
        prevX = xx;
        prevY = yy;
        prevT = time;
      }
      strokeRun();

      // A glowing dot at the newest point while a note is sounding.
      if (latest && Number.isFinite(headX)) {
        ctx.fillStyle = palette.zones[headZone];
        ctx.globalAlpha = 0.25;
        ctx.beginPath();
        ctx.arc(headX, headY, 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(headX, headY, 3.5, 0, 2 * Math.PI);
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      mq?.removeEventListener?.('change', onScheme);
      themeObserver?.disconnect();
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

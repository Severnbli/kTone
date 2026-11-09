import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import { frame } from '../test/frames';
import { ZONE_COLORS } from '../zones';
import { PitchCurve } from './PitchCurve';

/** Minimal 2D context that records the color and points of each stroke. */
function fakeContext() {
  const strokes: { color: string; alpha: number; ys: number[] }[] = [];
  let ys: number[] = [];
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '',
    textBaseline: 'alphabetic',
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    beginPath: () => {
      ys = [];
    },
    moveTo: (_x: number, y: number) => ys.push(y),
    lineTo: (_x: number, y: number) => ys.push(y),
    stroke: () => strokes.push({ color: ctx.strokeStyle, alpha: ctx.globalAlpha, ys }),
    arc: vi.fn(),
    fill: vi.fn(),
  };
  return { ctx, strokes };
}

describe('PitchCurve', () => {
  let rafCallbacks: FrameRequestCallback[] = [];
  let fake: ReturnType<typeof fakeContext>;

  beforeEach(() => {
    fake = fakeContext();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      fake.ctx as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 300,
      height: 200,
    } as DOMRect);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    rafCallbacks = [];
  });

  /**
   * Renders the curve for frames of `[raw cents, center cents]` and returns the
   * solid pitch strokes (each run of one zone color is also stroked once,
   * translucent, for the glow).
   */
  function draw(frames: [number, number][]) {
    const store = new PitchStore();
    render(
      <PitchCurve
        store={store}
        keySpec={{ tonic: 'C', accidental: 0, mode: 'major' }}
        naming="letter"
        zones={{ green: 10, yellow: 25 }}
      />,
    );
    act(() => {
      frames.forEach(([raw, center], i) =>
        store.push(frame(60, raw, { centerCents: center }), i * 11),
      );
    });
    const pending = rafCallbacks;
    rafCallbacks = [];
    pending.forEach((cb) => cb(0));
    // Pitch runs are the only strokes drawn in a zone color.
    const zoneColors: string[] = Object.values(ZONE_COLORS);
    const pitch = fake.strokes.filter((s) => zoneColors.includes(s.color));
    const glow = pitch.filter((s) => s.alpha < 1);
    const solid = pitch.filter((s) => s.alpha === 1);
    expect(glow.map((s) => s.color)).toEqual(solid.map((s) => s.color));
    return solid;
  }

  it('colors segments by the vibrato center but draws the raw pitch', () => {
    const vibrato = Array.from({ length: 20 }, (_, i): [number, number] => [40 * Math.sin(i), 2]);
    const runs = draw(vibrato);
    // One green run through all 20 points.
    expect(runs).toHaveLength(1);
    expect(runs[0].color).toBe(ZONE_COLORS.green);
    expect(runs[0].ys).toHaveLength(20);
    // The line itself still swings with the vibrato.
    const ys = runs[0].ys;
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
  });

  it('turns red when the center is off even if a frame is on pitch', () => {
    const segments = draw([
      [0, 40],
      [0, 40],
      [0, 40],
    ]);
    expect(segments.map((s) => s.color)).toEqual([ZONE_COLORS.red]);
  });

  it('starts a new run where the zone changes', () => {
    const runs = draw([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 40],
      [0, 40],
    ]);
    expect(runs.map((s) => s.color)).toEqual([ZONE_COLORS.green, ZONE_COLORS.red]);
    // The red run continues from the last green point, so the line has no gap.
    expect(runs.map((s) => s.ys.length)).toEqual([3, 3]);
  });

  it('draws only note labels that fit, the tonic first', () => {
    const store = new PitchStore();
    render(
      <PitchCurve
        store={store}
        keySpec={{ tonic: 'C', accidental: 0, mode: 'major' }}
        naming="letter"
        zones={{ green: 10, yellow: 25 }}
      />,
    );
    act(() => store.push(frame(64.5, 0), 0)); // between E and F: both 1 semitone apart
    rafCallbacks.splice(0).forEach((cb) => cb(0));
    const calls = fake.ctx.fillText.mock.calls as [string, number, number][];
    const ys = calls.map(([, , y]) => y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(14);
    for (const y of ys) {
      expect(y).toBeGreaterThan(5);
      expect(y).toBeLessThan(195);
    }
    expect(calls.map(([text]) => text)).toContain('C');
  });
});

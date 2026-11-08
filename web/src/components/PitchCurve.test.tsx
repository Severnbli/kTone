import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PitchStore } from '../audio/pitchStore';
import { frame } from '../test/frames';
import { ZONE_COLORS } from '../zones';
import { PitchCurve } from './PitchCurve';

/** Minimal 2D context that records the color and points of each stroke. */
function fakeContext() {
  const strokes: { color: string; ys: number[] }[] = [];
  let ys: number[] = [];
  const ctx = {
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
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
    stroke: () => strokes.push({ color: ctx.strokeStyle, ys }),
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

  /** Renders the curve for frames of `[raw cents, center cents]` and returns the pitch segments. */
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
    // Pitch segments are the only strokes drawn in a zone color.
    const zoneColors: string[] = Object.values(ZONE_COLORS);
    return fake.strokes.filter((s) => zoneColors.includes(s.color));
  }

  it('colors segments by the vibrato center but draws the raw pitch', () => {
    const vibrato = Array.from({ length: 20 }, (_, i): [number, number] => [40 * Math.sin(i), 2]);
    const segments = draw(vibrato);
    expect(segments).toHaveLength(19);
    expect(segments.every((s) => s.color === ZONE_COLORS.green)).toBe(true);
    // The line itself still swings with the vibrato.
    const ys = segments.flatMap((s) => s.ys);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(5);
  });

  it('turns red when the center is off even if a frame is on pitch', () => {
    const segments = draw([
      [0, 40],
      [0, 40],
      [0, 40],
    ]);
    expect(segments.map((s) => s.color)).toEqual([ZONE_COLORS.red, ZONE_COLORS.red]);
  });
});

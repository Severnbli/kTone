import { describe, expect, it } from 'vitest';
import { FrameScheduler, RingBuffer } from './frameScheduler';

const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe('RingBuffer', () => {
  it('returns the latest samples in order across wrap-around', () => {
    const rb = new RingBuffer(8);
    rb.write(ramp(0, 5));
    rb.write(ramp(5, 6)); // total 11, wraps
    expect(rb.filled).toBe(8);
    const out = new Float32Array(6);
    rb.readLatest(out);
    expect(Array.from(out)).toEqual([5, 6, 7, 8, 9, 10]);
  });

  it('keeps only the tail of an oversized block', () => {
    const rb = new RingBuffer(4);
    rb.write(ramp(0, 10));
    const out = new Float32Array(4);
    rb.readLatest(out);
    expect(Array.from(out)).toEqual([6, 7, 8, 9]);
  });

  it('clear resets fill level', () => {
    const rb = new RingBuffer(4);
    rb.write(ramp(0, 3));
    rb.clear();
    expect(rb.filled).toBe(0);
  });
});

describe('FrameScheduler', () => {
  it('waits for a full frame, then emits one frame per hop', () => {
    const frames: number[][] = [];
    const s = new FrameScheduler(8, 4, (f) => frames.push(Array.from(f)));
    let t = 0;
    const feed = (n: number) => {
      const emitted = s.push(ramp(t, n));
      t += n;
      return emitted;
    };
    expect(feed(4)).toBe(0); // 4 samples, frame not full
    expect(feed(4)).toBe(1); // 8 samples -> first frame
    expect(frames[0]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(feed(2)).toBe(0); // half a hop
    expect(feed(2)).toBe(1);
    expect(frames[1]).toEqual([4, 5, 6, 7, 8, 9, 10, 11]);
  });

  it('drops stale hops when a big block arrives (latest frame only)', () => {
    const frames: number[][] = [];
    const s = new FrameScheduler(8, 4, (f) => frames.push(Array.from(f)));
    s.push(ramp(0, 8));
    expect(s.dropped).toBe(0); // filling the first frame is no drop
    expect(s.push(ramp(8, 12))).toBe(1); // three hops worth, one frame
    expect(frames.at(-1)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(s.dropped).toBe(2);
    s.push(ramp(20, 4));
    expect(s.dropped).toBe(2);
    s.reset();
    expect(s.dropped).toBe(0);
  });

  it('works with 2048/512 and 128-sample worklet quanta', () => {
    let count = 0;
    const s = new FrameScheduler(2048, 512, (f) => {
      expect(f.length).toBe(2048);
      count++;
    });
    const block = new Float32Array(128);
    for (let i = 0; i < 64; i++) s.push(block); // 8192 samples
    // First frame at 2048, then every 512: (8192 - 2048) / 512 + 1
    expect(count).toBe(13);
    expect(s.dropped).toBe(0);
  });

  it('reset starts over', () => {
    let count = 0;
    const s = new FrameScheduler(4, 2, () => count++);
    s.push(new Float32Array(4));
    s.reset();
    s.push(new Float32Array(2));
    expect(count).toBe(1);
  });
});

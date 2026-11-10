// Ring buffer of the most recent samples plus hop scheduling. Fed with
// arbitrary-sized sample blocks from the AudioWorklet; emits one analysis frame
// (the latest `frameSize` samples) every `hopSize` new samples. When the main
// thread falls behind by several hops, only the newest frame is analyzed so
// latency never accumulates. No allocation after construction.

export class RingBuffer {
  private readonly data: Float32Array;
  private writePos = 0;
  /** Total samples ever written (saturates at capacity for `filled`). */
  private total = 0;

  constructor(readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get filled(): number {
    return Math.min(this.total, this.capacity);
  }

  write(block: Float32Array): void {
    let src = block;
    if (src.length > this.capacity) src = src.subarray(src.length - this.capacity);
    const first = Math.min(src.length, this.capacity - this.writePos);
    this.data.set(src.subarray(0, first), this.writePos);
    if (first < src.length) this.data.set(src.subarray(first), 0);
    this.writePos = (this.writePos + src.length) % this.capacity;
    this.total += block.length;
  }

  /** Copy the latest `out.length` samples (oldest first) into `out`. */
  readLatest(out: Float32Array): void {
    const n = out.length;
    if (n > this.capacity) throw new Error('read larger than capacity');
    const start = (this.writePos - n + this.capacity) % this.capacity;
    const first = Math.min(n, this.capacity - start);
    out.set(this.data.subarray(start, start + first), 0);
    if (first < n) out.set(this.data.subarray(0, n - first), first);
  }

  clear(): void {
    this.data.fill(0);
    this.writePos = 0;
    this.total = 0;
  }
}

export class FrameScheduler {
  private readonly ring: RingBuffer;
  private readonly frame: Float32Array;
  private sinceLastFrame = 0;
  /**
   * Hops skipped because a push brought more than one hop of new samples
   * (the main thread fell behind or the worklet sent large blocks). Only the
   * newest frame of such a push is analyzed.
   */
  dropped = 0;
  private emitted = false;

  constructor(
    readonly frameSize: number,
    readonly hopSize: number,
    private readonly onFrame: (frame: Float32Array) => void,
  ) {
    this.ring = new RingBuffer(frameSize * 2);
    this.frame = new Float32Array(frameSize);
  }

  /** Returns the number of frames emitted (0 or 1). */
  push(block: Float32Array): number {
    this.ring.write(block);
    this.sinceLastFrame += block.length;
    if (this.ring.filled < this.frameSize || this.sinceLastFrame < this.hopSize) return 0;
    // Filling the first frame is not falling behind.
    if (this.emitted) this.dropped += Math.floor(this.sinceLastFrame / this.hopSize) - 1;
    this.emitted = true;
    this.sinceLastFrame %= this.hopSize;
    this.ring.readLatest(this.frame);
    this.onFrame(this.frame);
    return 1;
  }

  reset(): void {
    this.ring.clear();
    this.sinceLastFrame = 0;
    this.emitted = false;
    this.dropped = 0;
  }
}

// AudioWorklet processor: collects mono input into blocks of `blockSize`
// samples and transfers them to the main thread. Buffers are recycled: the main
// thread transfers each block back after copying it, so the steady state does
// not allocate on the audio thread. A new buffer is allocated only when the pool
// runs dry (e.g. the main thread is busy), which is rare and bounded.
'use strict';

const POOL_LIMIT = 16;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.blockSize = opts.blockSize || 512;
    this.pool = [];
    for (let i = 0; i < 8; i++) this.pool.push(new Float32Array(this.blockSize));
    this.current = this.pool.pop();
    this.fill = 0;
    this.port.onmessage = (event) => {
      const buf = event.data;
      if (buf instanceof Float32Array && buf.length === this.blockSize) {
        if (this.pool.length < POOL_LIMIT) this.pool.push(buf);
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;
    let offset = 0;
    while (offset < channel.length) {
      const n = Math.min(channel.length - offset, this.blockSize - this.fill);
      this.current.set(channel.subarray(offset, offset + n), this.fill);
      this.fill += n;
      offset += n;
      if (this.fill === this.blockSize) {
        const full = this.current;
        this.port.postMessage(full, [full.buffer]);
        this.current = this.pool.pop() || new Float32Array(this.blockSize);
        this.fill = 0;
      }
    }
    return true;
  }
}

registerProcessor('ktone-capture', CaptureProcessor);

import { describe, expect, it, vi } from 'vitest';
import { frame } from '../test/frames';
import {
  DRONE_LEAK_GAP_MS,
  DRONE_LEAK_SHOW_MS,
  HISTORY_CAPACITY,
  PitchStore,
  SILENCE_HOLD_MS,
} from './pitchStore';

describe('PitchStore', () => {
  it('notifies note listeners only when the note changes', () => {
    const store = new PitchStore();
    const onNote = vi.fn();
    const onFrame = vi.fn();
    store.subscribeNote(onNote);
    store.subscribeFrame(onFrame);
    store.push(frame(69, 3), 0);
    store.push(frame(69, -4), 10);
    store.push(frame(69, 8), 20);
    expect(onFrame).toHaveBeenCalledTimes(3);
    expect(onNote).toHaveBeenCalledTimes(1);
    store.push(frame(70, 0, { note: { letter: 'B', accidental: -1, octave: 4 } }), 30);
    expect(onNote).toHaveBeenCalledTimes(2);
    expect(store.getNote()?.note.letter).toBe('B');
  });

  it('keeps the note through short silences, then marks it inactive', () => {
    const store = new PitchStore();
    store.push(frame(69), 0);
    store.push(null, 100);
    expect(store.getNote()?.active).toBe(true);
    store.push(null, SILENCE_HOLD_MS + 1);
    expect(store.getNote()?.active).toBe(false);
    expect(store.latest).toBeNull();
  });

  it('records history in a fixed ring', () => {
    const store = new PitchStore();
    for (let i = 0; i < HISTORY_CAPACITY + 10; i++) store.push(i % 2 ? null : frame(60), i);
    const h = store.history;
    expect(h.size).toBe(HISTORY_CAPACITY);
    expect(h.time[h.at(0)]).toBe(10);
    expect(h.time[h.at(h.size - 1)]).toBe(HISTORY_CAPACITY + 9);
    expect(Number.isNaN(h.midi[h.at(h.size - 1)])).toBe(true);
  });

  it('records the vibrato center next to the raw pitch', () => {
    const store = new PitchStore();
    store.push(frame(60, 40, { centerCents: 2 }), 0);
    store.push(null, 10);
    const h = store.history;
    expect(h.midi[h.at(0)]).toBeCloseTo(60.4);
    expect(h.centerCents[h.at(0)]).toBeCloseTo(2);
    expect(Number.isNaN(h.centerCents[h.at(1)])).toBe(true);
  });

  it('reset clears note and history', () => {
    const store = new PitchStore();
    store.push(frame(69), 0);
    const onNote = vi.fn();
    store.subscribeNote(onNote);
    store.reset();
    expect(store.getNote()).toBeNull();
    expect(store.history.size).toBe(0);
    expect(onNote).toHaveBeenCalledOnce();
  });

  it('unsubscribe stops notifications', () => {
    const store = new PitchStore();
    const l = vi.fn();
    const off = store.subscribeFrame(l);
    off();
    store.push(frame(69), 0);
    expect(l).not.toHaveBeenCalled();
  });

  describe('drone leak', () => {
    /** Pushes unpitched frames every 10 ms from `from` to `to` (exclusive). */
    const leak = (store: PitchStore, from: number, to: number, droneLeak = true) => {
      for (let t = from; t < to; t += 10) store.push(null, t, droneLeak);
    };

    it('is reported after the mic has heard the drone for a while', () => {
      const store = new PitchStore();
      const l = vi.fn();
      store.subscribeDroneLeak(l);
      leak(store, 0, DRONE_LEAK_SHOW_MS);
      expect(store.getDroneLeak()).toBe(false);
      leak(store, DRONE_LEAK_SHOW_MS, DRONE_LEAK_SHOW_MS + 20);
      expect(store.getDroneLeak()).toBe(true);
      expect(l).toHaveBeenCalledOnce();
    });

    it('survives short gaps and clears when the leak stops', () => {
      const store = new PitchStore();
      leak(store, 0, 1000);
      leak(store, 1000, 1000 + DRONE_LEAK_GAP_MS - 50, false); // e.g. a short sung note
      leak(store, 1450, 2000);
      expect(store.getDroneLeak()).toBe(true);
      // Singing: pitched frames, no leak.
      const lastLeak = 1990;
      for (let t = 2000; t <= lastLeak + DRONE_LEAK_GAP_MS; t += 10)
        store.push(frame(62), t, false);
      expect(store.getDroneLeak()).toBe(true);
      store.push(frame(62), lastLeak + DRONE_LEAK_GAP_MS + 10, false);
      expect(store.getDroneLeak()).toBe(false);
      // A new run has to last long enough again.
      leak(store, 3000, 3000 + DRONE_LEAK_SHOW_MS);
      expect(store.getDroneLeak()).toBe(false);
    });

    it('is cleared by reset', () => {
      const store = new PitchStore();
      leak(store, 0, DRONE_LEAK_SHOW_MS + 100);
      expect(store.getDroneLeak()).toBe(true);
      store.reset();
      expect(store.getDroneLeak()).toBe(false);
      leak(store, 5000, 5100);
      expect(store.getDroneLeak()).toBe(false);
    });
  });
});

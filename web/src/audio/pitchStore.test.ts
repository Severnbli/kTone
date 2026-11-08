import { describe, expect, it, vi } from 'vitest';
import { frame } from '../test/frames';
import { HISTORY_CAPACITY, PitchStore, SILENCE_HOLD_MS } from './pitchStore';

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
});

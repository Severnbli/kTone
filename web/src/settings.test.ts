import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  MAX_DEVICE_ID_LENGTH,
  STORAGE_KEY,
  loadSettings,
  sanitizeSettings,
  saveSettings,
  type Settings,
} from './settings';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}

const throwing: Storage = {
  length: 0,
  clear() {},
  key: () => null,
  getItem() {
    throw new DOMException('denied', 'SecurityError');
  },
  setItem() {
    throw new DOMException('full', 'QuotaExceededError');
  },
  removeItem() {},
};

describe('settings persistence', () => {
  it('defaults: C major, treble, A4 = 440, solfège, ±10/±25', () => {
    expect(loadSettings(new MemoryStorage())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({
      lang: 'ru',
      clef: 'treble',
      a4Hz: 440,
      naming: 'solfege',
      zones: { green: 10, yellow: 25 },
    });
  });

  it('round-trips through storage', () => {
    const s = new MemoryStorage();
    const custom: Settings = {
      ...DEFAULT_SETTINGS,
      key: { tonic: 'D', accidental: -1, mode: 'major' },
      clef: 'bass',
      a4Hz: 442,
      naming: 'letter',
      degreeStyle: 'arabic',
      zones: { green: 5, yellow: 15 },
      drone: { volume: 0.5, octave: 2 },
      lang: 'en',
      theme: 'light',
      micDeviceId: 'usb-1',
    };
    expect(saveSettings(custom, s)).toBe(true);
    expect(loadSettings(s)).toEqual(custom);
  });

  it('never throws when storage throws', () => {
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(saveSettings(DEFAULT_SETTINGS, throwing)).toBe(false);
  });

  it('falls back on corrupt JSON', () => {
    const s = new MemoryStorage();
    s.setItem(STORAGE_KEY, '{not json');
    expect(loadSettings(s)).toEqual(DEFAULT_SETTINGS);
  });

  it('sanitizes invalid fields individually', () => {
    const s = sanitizeSettings({
      key: { tonic: 'H', accidental: 0, mode: 'major' },
      clef: 'soprano',
      a4Hz: 500,
      naming: 'letter',
      zones: { green: 30, yellow: 20 },
      drone: { volume: 7, octave: 9 },
    });
    expect(s.key).toEqual(DEFAULT_SETTINGS.key);
    expect(s.clef).toBe('treble');
    expect(s.a4Hz).toBe(466);
    expect(s.naming).toBe('letter');
    expect(s.zones).toEqual({ green: 30, yellow: 30 });
    expect(s.drone).toEqual({ volume: 1, octave: 3 });
  });

  it('keeps the drone filter on unless it was switched off', () => {
    expect(DEFAULT_SETTINGS.droneFilter).toBe(true);
    expect(sanitizeSettings({ droneFilter: false }).droneFilter).toBe(false);
    expect(sanitizeSettings({ droneFilter: 'no' }).droneFilter).toBe(true);
    // Settings saved before the filter existed.
    expect(sanitizeSettings({ drone: { volume: 0.5, octave: 4 } }).droneFilter).toBe(true);
    const s = new MemoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, droneFilter: false }, s);
    expect(loadSettings(s).droneFilter).toBe(false);
  });

  it('follows the system theme by default and validates the saved theme', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('system');
    expect(sanitizeSettings({ theme: 'dark' }).theme).toBe('dark');
    expect(sanitizeSettings({ theme: 'light' }).theme).toBe('light');
    expect(sanitizeSettings({ theme: 'neon' }).theme).toBe('system');
    expect(sanitizeSettings({ theme: 1 }).theme).toBe('system');
    // Settings saved before the theme existed.
    expect(sanitizeSettings({ lang: 'en' }).theme).toBe('system');
    const s = new MemoryStorage();
    saveSettings({ ...DEFAULT_SETTINGS, theme: 'dark' }, s);
    expect(loadSettings(s).theme).toBe('dark');
  });

  it('keeps a string device id and drops anything else', () => {
    expect(DEFAULT_SETTINGS.micDeviceId).toBe('');
    expect(sanitizeSettings({ micDeviceId: 'abc' }).micDeviceId).toBe('abc');
    expect(sanitizeSettings({ micDeviceId: 42 }).micDeviceId).toBe('');
    expect(sanitizeSettings({ micDeviceId: null }).micDeviceId).toBe('');
    expect(
      sanitizeSettings({ micDeviceId: 'x'.repeat(MAX_DEVICE_ID_LENGTH + 1) }).micDeviceId,
    ).toBe('');
    // Settings saved before this field existed.
    expect(sanitizeSettings({ clef: 'bass' }).micDeviceId).toBe('');
  });

  it('keeps the target off by default and validates a saved one against the key', () => {
    expect(DEFAULT_SETTINGS.target).toEqual({ enabled: false, degree: 1, octave: 4 });
    expect(DEFAULT_SETTINGS.droneTarget).toBe(false);
    // Settings saved before the target existed.
    expect(sanitizeSettings({ clef: 'bass' }).target).toEqual(DEFAULT_SETTINGS.target);
    expect(sanitizeSettings({ target: { enabled: true, degree: 6, octave: 4 } }).target).toEqual({
      enabled: true,
      degree: 6,
      octave: 4,
    });
    expect(sanitizeSettings({ target: { enabled: 1, degree: 8, octave: 'x' } }).target).toEqual(
      DEFAULT_SETTINGS.target,
    );
    // D6 is above the voice range (C6): the octave is pulled back to D5.
    const d = sanitizeSettings({
      key: { tonic: 'D', accidental: 0, mode: 'major' },
      target: { enabled: true, degree: 1, octave: 6 },
    });
    expect(d.target).toEqual({ enabled: true, degree: 1, octave: 5 });
    expect(sanitizeSettings({ droneTarget: true }).droneTarget).toBe(true);
    expect(sanitizeSettings({ droneTarget: 'on' }).droneTarget).toBe(false);
    const s = new MemoryStorage();
    const custom: Settings = {
      ...DEFAULT_SETTINGS,
      droneTarget: true,
      target: { enabled: true, degree: 3, octave: 5 },
    };
    saveSettings(custom, s);
    expect(loadSettings(s)).toEqual(custom);
  });

  it('uses window.localStorage by default', () => {
    saveSettings({ ...DEFAULT_SETTINGS, a4Hz: 432 });
    expect(loadSettings().a4Hz).toBe(432);
  });
});

import type { ClefId, KeySpec } from './engine/types';
import type { Lang } from './i18n/strings';
import { ALL_KEYS, DEFAULT_KEY } from './music/keys';
import type { DegreeStyle, NoteNaming } from './music/naming';
import { sameKey } from './music/theory';
import type { ZoneThresholds } from './zones';

export const CLEFS: readonly ClefId[] = ['treble', 'treble8vb', 'bass', 'alto', 'tenor'];
export const A4_MIN = 415;
export const A4_MAX = 466;
export const DRONE_OCTAVES = [2, 3, 4, 5] as const;

export interface Settings {
  lang: Lang;
  key: KeySpec;
  clef: ClefId;
  a4Hz: number;
  naming: NoteNaming;
  degreeStyle: DegreeStyle;
  zones: ZoneThresholds;
  drone: { volume: number; octave: number };
  /** Do not show the drone leaking from the speakers into the mic as a sung note. */
  droneFilter: boolean;
  /** Audio input `deviceId`; `''` is the system default. */
  micDeviceId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'ru',
  key: DEFAULT_KEY,
  clef: 'treble',
  a4Hz: 440,
  naming: 'solfege',
  degreeStyle: 'roman',
  zones: { green: 10, yellow: 25 },
  drone: { volume: 0.3, octave: 3 },
  droneFilter: true,
  micDeviceId: '',
};

/** Device ids are opaque strings (Chrome: 64 hex chars); anything longer is junk. */
export const MAX_DEVICE_ID_LENGTH = 256;

export const STORAGE_KEY = 'ktone.settings.v1';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Validate arbitrary (possibly stale or hand-edited) data, falling back field by field. */
export function sanitizeSettings(raw: unknown): Settings {
  const d = DEFAULT_SETTINGS;
  if (!raw || typeof raw !== 'object') return structuredClone(d);
  const r = raw as Record<string, unknown>;
  const key = ALL_KEYS.find((k) => r.key && sameKey(k, r.key as KeySpec)) ?? d.key;
  const zonesRaw = (r.zones ?? {}) as Record<string, unknown>;
  const green = isNum(zonesRaw.green) ? clamp(zonesRaw.green, 1, 49) : d.zones.green;
  const yellow = isNum(zonesRaw.yellow)
    ? clamp(zonesRaw.yellow, green, 50)
    : Math.max(green, d.zones.yellow);
  const droneRaw = (r.drone ?? {}) as Record<string, unknown>;
  return {
    lang: r.lang === 'en' || r.lang === 'ru' ? r.lang : d.lang,
    key: { ...key },
    clef: CLEFS.includes(r.clef as ClefId) ? (r.clef as ClefId) : d.clef,
    a4Hz: isNum(r.a4Hz) ? clamp(r.a4Hz, A4_MIN, A4_MAX) : d.a4Hz,
    naming: r.naming === 'letter' || r.naming === 'solfege' ? r.naming : d.naming,
    degreeStyle:
      r.degreeStyle === 'arabic' || r.degreeStyle === 'roman' ? r.degreeStyle : d.degreeStyle,
    zones: { green, yellow },
    drone: {
      volume: isNum(droneRaw.volume) ? clamp(droneRaw.volume, 0, 1) : d.drone.volume,
      octave: DRONE_OCTAVES.includes(droneRaw.octave as 3)
        ? (droneRaw.octave as number)
        : d.drone.octave,
    },
    droneFilter: typeof r.droneFilter === 'boolean' ? r.droneFilter : d.droneFilter,
    micDeviceId:
      typeof r.micDeviceId === 'string' && r.micDeviceId.length <= MAX_DEVICE_ID_LENGTH
        ? r.micDeviceId
        : d.micDeviceId,
  };
}

/** Load settings; never throws (storage may be disabled or full, data may be corrupt). */
export function loadSettings(storage: Storage | undefined = safeLocalStorage()): Settings {
  try {
    const text = storage?.getItem(STORAGE_KEY);
    return sanitizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return sanitizeSettings(null);
  }
}

/** Persist settings; returns false when storage is unavailable. Never throws. */
export function saveSettings(
  settings: Settings,
  storage: Storage | undefined = safeLocalStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

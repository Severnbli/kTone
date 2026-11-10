// Target note («пой эту ноту»): the singer picks a scale degree of the current
// key and an octave, and accuracy is measured from that note instead of the
// nearest semitone. Pure functions, no React.

import type { ClefId, KeySpec, SpelledNote } from '../engine/types';
import type { Lang, Strings } from '../i18n/strings';
import { classifyCents, type Zone, type ZoneThresholds } from '../zones';
import { scaleOf, spelledToMidi } from './theory';

/** Lowest target: E2 (bass). */
export const TARGET_MIN_MIDI = 40;
/** Lowest target in low range mode: G1 (octavist bass). */
export const TARGET_LOW_MIN_MIDI = 31;

/** Lowest target note for the range mode. */
export const targetMinMidi = (lowRange = false) =>
  lowRange ? TARGET_LOW_MIN_MIDI : TARGET_MIN_MIDI;
/** Highest target: C6 (soprano). */
export const TARGET_MAX_MIDI = 84;
export const DEGREES = [1, 2, 3, 4, 5, 6, 7] as const;

export interface Target {
  enabled: boolean;
  /** Scale degree 1..7 of the current key (natural minor for minor keys). */
  degree: number;
  /** Scientific octave of the target note itself (C♭4 is in octave 4, sounds as B3). */
  octave: number;
}

export const DEFAULT_TARGET: Target = { enabled: false, degree: 1, octave: 4 };

/** Octave a new target starts in when nothing has been sung yet. */
const CLEF_OCTAVE: Record<ClefId, number> = {
  treble: 4,
  alto: 4,
  tenor: 3,
  treble8vb: 3,
  bass: 3,
};

/** The target spelled in the key: the degree's letter and accidental in `octave`. */
export function targetNote(key: KeySpec, degree: number, octave: number): SpelledNote {
  const n = scaleOf(key)[degree - 1];
  return { letter: n.letter, accidental: n.accidental, octave };
}

export function targetMidi(key: KeySpec, degree: number, octave: number): number {
  return spelledToMidi(targetNote(key, degree, octave));
}

/**
 * Octaves in which the degree lies inside the voice range E2–C6 (G1–C6 in
 * low range mode). Never empty.
 */
export function octaveRange(
  key: KeySpec,
  degree: number,
  lowRange = false,
): { min: number; max: number } {
  const base = targetMidi(key, degree, 0);
  return {
    min: Math.ceil((targetMinMidi(lowRange) - base) / 12),
    max: Math.floor((TARGET_MAX_MIDI - base) / 12),
  };
}

export function clampOctave(
  key: KeySpec,
  degree: number,
  octave: number,
  lowRange = false,
): number {
  const { min, max } = octaveRange(key, degree, lowRange);
  return Math.min(max, Math.max(min, Math.round(octave)));
}

/** Octave that puts the degree closest to `midi` (ties go to the lower one), within range. */
export function nearestOctave(
  key: KeySpec,
  degree: number,
  midi: number,
  lowRange = false,
): number {
  const base = targetMidi(key, degree, 0);
  return clampOctave(key, degree, Math.ceil((midi - base) / 12 - 0.5), lowRange);
}

/**
 * The target a fresh switch-on picks: the tonic closest to the last sung note,
 * or, before anything was sung, in the clef's usual octave.
 */
export function defaultTarget(
  key: KeySpec,
  clef: ClefId,
  lastMidi: number | null,
  lowRange = false,
): Target {
  const octave =
    lastMidi !== null && Number.isFinite(lastMidi)
      ? nearestOctave(key, 1, lastMidi, lowRange)
      : clampOctave(key, 1, CLEF_OCTAVE[clef], lowRange);
  return { enabled: true, degree: 1, octave };
}

/** Keep the degree and octave for a new key or range, pulling the octave back into range. */
export function fitTarget(target: Target, key: KeySpec, lowRange = false): Target {
  return { ...target, octave: clampOctave(key, target.degree, target.octave, lowRange) };
}

/** Validate stored (possibly stale or hand-edited) data, field by field. */
export function sanitizeTarget(raw: unknown, key: KeySpec, lowRange = false): Target {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const degree =
    typeof r.degree === 'number' && Number.isInteger(r.degree) && r.degree >= 1 && r.degree <= 7
      ? r.degree
      : DEFAULT_TARGET.degree;
  const octave =
    typeof r.octave === 'number' && Number.isFinite(r.octave) ? r.octave : DEFAULT_TARGET.octave;
  return fitTarget(
    {
      enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_TARGET.enabled,
      degree,
      octave,
    },
    key,
    lowRange,
  );
}

/**
 * How the vibrato center relates to the target:
 * - `near`: within half a semitone, judged by the usual zones;
 * - `octave`: the right note in another octave (within half a semitone of it);
 * - `far`: another note, `semitones` away.
 */
export type TargetState = 'near' | 'far' | 'octave';

export interface TargetReading {
  state: TargetState;
  /** (center − target) in cents; negative = below the target. */
  cents: number;
  /** Nearest whole number of semitones from the target (0 when near). */
  semitones: number;
  /** Whole octaves from the target in the `octave` state, else 0. */
  octaves: number;
  zone: Zone;
}

export function assessTarget(
  centerMidi: number,
  target: number,
  zones: ZoneThresholds,
): TargetReading {
  const cents = (centerMidi - target) * 100;
  const semitones = Math.round(cents / 100) || 0;
  if (semitones === 0) {
    return { state: 'near', cents, semitones: 0, octaves: 0, zone: classifyCents(cents, zones) };
  }
  const octave = semitones % 12 === 0;
  return {
    state: octave ? 'octave' : 'far',
    cents,
    semitones,
    octaves: octave ? semitones / 12 : 0,
    zone: 'red',
  };
}

/**
 * Where a pitch view (the curve) should be centered. Without a target it
 * follows the sung note; with one it stays on the target, moving only as far
 * as needed to keep the sung note within `reach` semitones of the center.
 */
export function viewCenter(sung: number, target: number | null, reach: number): number {
  if (target === null) return sung;
  if (!Number.isFinite(sung)) return target;
  return Math.min(sung + reach, Math.max(sung - reach, target));
}

/** Plural form index: 0 «полутон», 1 «полутона», 2 «полутонов»; English 0 one, 2 other. */
export function pluralIndex(n: number, lang: Lang): 0 | 1 | 2 {
  const a = Math.abs(n);
  if (lang === 'en') return a === 1 ? 0 : 2;
  const d = a % 10;
  const h = a % 100;
  if (d === 1 && h !== 11) return 0;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return 1;
  return 2;
}

export function semitonesText(n: number, t: Strings, lang: Lang): string {
  const unit = [t.semitoneOne, t.semitoneFew, t.semitoneMany][pluralIndex(n, lang)];
  return `${Math.abs(n)} ${unit}`;
}

/**
 * What to tell the singer away from the target, or '' when near it. The far
 * message is an instruction («выше на 2 полутона»: sing higher); the octave
 * hint describes the octave being sung («нота верная, октава ниже»).
 */
export function targetMessage(reading: TargetReading, t: Strings, lang: Lang): string {
  if (reading.state === 'near') return '';
  if (reading.state === 'octave') {
    const k = Math.abs(reading.octaves);
    const low = reading.octaves < 0;
    if (k === 1) return low ? t.rightNoteOctaveLower : t.rightNoteOctaveHigher;
    const unit = [t.octaveOne, t.octaveFew, t.octaveMany][pluralIndex(k, lang)];
    return (low ? t.rightNoteOctavesLower : t.rightNoteOctavesHigher)
      .replace('{n}', String(k))
      .replace('{unit}', unit);
  }
  const amount = semitonesText(reading.semitones, t, lang);
  return (reading.semitones < 0 ? t.targetGoHigher : t.targetGoLower).replace('{n}', amount);
}

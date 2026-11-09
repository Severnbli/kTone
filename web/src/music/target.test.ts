import { describe, expect, it } from 'vitest';
import type { KeySpec } from '../engine/types';
import { STRINGS } from '../i18n/strings';
import { ALL_KEYS } from './keys';
import { formatNote } from './naming';
import {
  DEFAULT_TARGET,
  TARGET_MAX_MIDI,
  TARGET_MIN_MIDI,
  assessTarget,
  clampOctave,
  defaultTarget,
  fitTarget,
  nearestOctave,
  octaveRange,
  pluralIndex,
  sanitizeTarget,
  semitonesText,
  targetMessage,
  targetMidi,
  targetNote,
} from './target';
import { keyId, mod, tonicPc } from './theory';

const key = (tonic: KeySpec['tonic'], accidental: number, mode: KeySpec['mode']): KeySpec => ({
  tonic,
  accidental,
  mode,
});
const C = key('C', 0, 'major');
const zones = { green: 10, yellow: 25 };
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR = [0, 2, 3, 5, 7, 8, 10];

describe('degree → note', () => {
  it.each(ALL_KEYS.map((k) => [keyId(k), k] as const))(
    '%s: every degree lands on the scale (natural minor for minor keys)',
    (_id, k) => {
      const steps = k.mode === 'major' ? MAJOR : NATURAL_MINOR;
      for (let d = 1; d <= 7; d++) {
        expect(mod(targetMidi(k, d, 4) - tonicPc(k), 12)).toBe(steps[d - 1]);
      }
    },
  );

  it('spells the target in the key', () => {
    expect(targetNote(C, 6, 4)).toEqual({ letter: 'A', accidental: 0, octave: 4 });
    expect(targetMidi(C, 6, 4)).toBe(69);
    expect(targetMidi(C, 5, 4)).toBe(67);
    expect(targetNote(key('D', 0, 'major'), 3, 4)).toEqual({
      letter: 'F',
      accidental: 1,
      octave: 4,
    });
    expect(targetNote(key('D', -1, 'major'), 3, 4)).toEqual({
      letter: 'F',
      accidental: 0,
      octave: 4,
    });
  });

  it('handles C♭ major and C♯ major at the octave boundary', () => {
    const cFlat = key('C', -1, 'major');
    expect(targetNote(cFlat, 1, 4)).toEqual({ letter: 'C', accidental: -1, octave: 4 });
    expect(targetMidi(cFlat, 1, 4)).toBe(59); // sounds as B3
    expect(targetNote(cFlat, 4, 4)).toEqual({ letter: 'F', accidental: -1, octave: 4 });
    expect(targetMidi(cFlat, 4, 4)).toBe(64);
    const cSharp = key('C', 1, 'major');
    expect(targetNote(cSharp, 7, 4)).toEqual({ letter: 'B', accidental: 1, octave: 4 });
    expect(targetMidi(cSharp, 7, 4)).toBe(72); // sounds as C5
    expect(targetNote(cSharp, 3, 4)).toEqual({ letter: 'E', accidental: 1, octave: 4 });
  });

  it('minor keys: A minor III is C, D♯ minor VI is B, E♭ minor VII is D♭', () => {
    expect(targetMidi(key('A', 0, 'minor'), 3, 4)).toBe(60);
    expect(targetNote(key('D', 1, 'minor'), 6, 4)).toEqual({
      letter: 'B',
      accidental: 0,
      octave: 4,
    });
    expect(targetNote(key('E', -1, 'minor'), 7, 4)).toEqual({
      letter: 'D',
      accidental: -1,
      octave: 4,
    });
  });
});

describe('octave bounds (E2–C6)', () => {
  it('C major: I in octaves 3–6, III in 2–5', () => {
    expect(octaveRange(C, 1)).toEqual({ min: 3, max: 6 });
    expect(octaveRange(C, 3)).toEqual({ min: 2, max: 5 });
  });

  it('every key and degree: the range is exactly the octaves inside the voice range', () => {
    for (const k of ALL_KEYS) {
      for (let d = 1; d <= 7; d++) {
        const { min, max } = octaveRange(k, d);
        expect(max).toBeGreaterThanOrEqual(min + 2);
        for (let o = min; o <= max; o++) {
          expect(targetMidi(k, d, o)).toBeGreaterThanOrEqual(TARGET_MIN_MIDI);
          expect(targetMidi(k, d, o)).toBeLessThanOrEqual(TARGET_MAX_MIDI);
        }
        expect(targetMidi(k, d, min - 1)).toBeLessThan(TARGET_MIN_MIDI);
        expect(targetMidi(k, d, max + 1)).toBeGreaterThan(TARGET_MAX_MIDI);
      }
    }
  });

  it('clamps and rounds octaves', () => {
    expect(clampOctave(C, 1, 1)).toBe(3);
    expect(clampOctave(C, 1, 9)).toBe(6);
    expect(clampOctave(C, 3, 4.4)).toBe(4);
  });

  it('nearest octave to a sung note, ties to the lower one', () => {
    expect(nearestOctave(C, 1, 69)).toBe(5); // A4 → C5 (3 up) beats C4 (9 down)
    expect(nearestOctave(C, 1, 62)).toBe(4);
    expect(nearestOctave(C, 1, 66)).toBe(4); // F♯4: C4 and C5 are both 6 away
    expect(nearestOctave(C, 1, 30)).toBe(3);
    expect(nearestOctave(C, 1, 100)).toBe(6);
  });
});

describe('default target and key changes', () => {
  it('the tonic near the last sung note', () => {
    expect(defaultTarget(C, 'treble', 69)).toEqual({ enabled: true, degree: 1, octave: 5 });
    expect(defaultTarget(C, 'bass', 55)).toEqual({ enabled: true, degree: 1, octave: 4 });
  });

  it('without a sung note, the clef decides', () => {
    expect(defaultTarget(C, 'treble', null).octave).toBe(4);
    expect(defaultTarget(C, 'alto', null).octave).toBe(4);
    expect(defaultTarget(C, 'bass', null).octave).toBe(3);
    expect(defaultTarget(C, 'treble8vb', null).octave).toBe(3);
    expect(defaultTarget(C, 'tenor', NaN).octave).toBe(3);
  });

  it('keeps the degree on a key change and pulls the octave into range', () => {
    const t = { enabled: true, degree: 3, octave: 5 };
    expect(fitTarget(t, key('D', 0, 'major'))).toEqual(t); // F♯5
    expect(targetNote(key('D', 0, 'major'), 3, 5).letter).toBe('F');
    expect(fitTarget({ enabled: true, degree: 1, octave: 2 }, C).octave).toBe(3);
    expect(fitTarget({ enabled: true, degree: 1, octave: 6 }, key('D', 0, 'major')).octave).toBe(5);
  });
});

describe('sanitizeTarget', () => {
  it('falls back field by field', () => {
    expect(sanitizeTarget(undefined, C)).toEqual(DEFAULT_TARGET);
    expect(sanitizeTarget('junk', C)).toEqual(DEFAULT_TARGET);
    expect(sanitizeTarget({ enabled: 'yes', degree: 9, octave: 'x' }, C)).toEqual(DEFAULT_TARGET);
    expect(sanitizeTarget({ enabled: true, degree: 2.5, octave: 4 }, C)).toEqual({
      enabled: true,
      degree: 1,
      octave: 4,
    });
    expect(sanitizeTarget({ enabled: true, degree: 0, octave: Infinity }, C).degree).toBe(1);
  });

  it('keeps valid values and clamps the octave to the voice range', () => {
    expect(sanitizeTarget({ enabled: true, degree: 6, octave: 4 }, C)).toEqual({
      enabled: true,
      degree: 6,
      octave: 4,
    });
    expect(sanitizeTarget({ enabled: false, degree: 3, octave: 8 }, C).octave).toBe(5);
    expect(sanitizeTarget({ enabled: false, degree: 1, octave: -3 }, C).octave).toBe(3);
  });
});

describe('assessTarget', () => {
  it('near the target: cents from the target and the usual zones', () => {
    expect(assessTarget(69, 69, zones)).toMatchObject({ state: 'near', cents: 0, zone: 'green' });
    const r = assessTarget(69.2, 69, zones);
    expect(r.state).toBe('near');
    expect(r.cents).toBeCloseTo(20);
    expect(r.zone).toBe('yellow');
    expect(assessTarget(68.6, 69, zones)).toMatchObject({ state: 'near', zone: 'red' });
    expect(assessTarget(68.6, 69, zones).semitones).toBe(0);
  });

  it('beyond half a semitone: whole semitones away', () => {
    expect(assessTarget(69, 67, zones)).toMatchObject({ state: 'far', semitones: 2, zone: 'red' });
    expect(assessTarget(68.3, 69, zones)).toMatchObject({ state: 'far', semitones: -1 });
    expect(assessTarget(64.1, 69, zones)).toMatchObject({ state: 'far', semitones: -5 });
  });

  it('the right note in the wrong octave', () => {
    expect(assessTarget(69, 57, zones)).toMatchObject({
      state: 'octave',
      semitones: 12,
      octaves: 1,
    });
    expect(assessTarget(45.2, 69, zones)).toMatchObject({ state: 'octave', octaves: -2 });
    // An octave and a semitone off is just far.
    expect(assessTarget(70, 57, zones)).toMatchObject({ state: 'far', octaves: 0 });
  });
});

describe('messages', () => {
  it('Russian plural forms', () => {
    const forms = [1, 2, 3, 4, 5, 11, 12, 14, 21, 22, 25, 111, 101].map((n) =>
      pluralIndex(n, 'ru'),
    );
    expect(forms).toEqual([0, 1, 1, 1, 2, 2, 2, 2, 0, 1, 2, 2, 0]);
    expect(semitonesText(1, STRINGS.ru, 'ru')).toBe('1 полутон');
    expect(semitonesText(-2, STRINGS.ru, 'ru')).toBe('2 полутона');
    expect(semitonesText(5, STRINGS.ru, 'ru')).toBe('5 полутонов');
    expect(semitonesText(11, STRINGS.ru, 'ru')).toBe('11 полутонов');
    expect(semitonesText(21, STRINGS.ru, 'ru')).toBe('21 полутон');
  });

  it('English plural forms', () => {
    expect(semitonesText(1, STRINGS.en, 'en')).toBe('1 semitone');
    expect(semitonesText(2, STRINGS.en, 'en')).toBe('2 semitones');
    expect(semitonesText(21, STRINGS.en, 'en')).toBe('21 semitones');
  });

  const msg = (center: number, target: number, lang: 'ru' | 'en' = 'ru') =>
    targetMessage(assessTarget(center, target, zones), STRINGS[lang], lang);

  it('is an instruction: sung above the target → sing lower', () => {
    expect(msg(69, 67)).toBe('ниже на 2 полутона');
    expect(msg(68, 69)).toBe('выше на 1 полутон');
    expect(msg(62, 69)).toBe('выше на 7 полутонов');
    expect(msg(69, 67, 'en')).toBe('sing 2 semitones lower');
    expect(msg(68, 69, 'en')).toBe('sing 1 semitone higher');
  });

  it('octave hints', () => {
    expect(msg(69, 57)).toBe('нота верная, октава выше');
    expect(msg(57, 69)).toBe('нота верная, октава ниже');
    expect(msg(45, 69)).toBe('нота верная, на 2 октавы ниже');
    expect(msg(81, 57)).toBe('нота верная, на 2 октавы выше');
    expect(msg(57, 69, 'en')).toBe('right note, an octave too low');
    expect(msg(45, 69, 'en')).toBe('right note, 2 octaves too low');
  });

  it('nothing to say near the target', () => {
    expect(msg(69.3, 69)).toBe('');
  });

  it('the preview names the target in full', () => {
    expect(formatNote(targetNote(C, 3, 4), 'solfege', 'ru').full).toBe('ми первой октавы');
    expect(formatNote(targetNote(C, 3, 4), 'letter', 'ru').full).toBe('E4');
  });
});

import { useId, useState } from 'react';
import type { ClefId, KeySpec } from '../engine/types';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import {
  compactNote,
  formatDegree,
  formatNote,
  pitchName,
  russianOctave,
  type DegreeStyle,
  type NoteNaming,
} from '../music/naming';
import {
  DEGREES,
  clampOctave,
  defaultTarget,
  octaveRange,
  targetNote,
  type Target,
} from '../music/target';
import { Switch } from './controls';
import { TargetIcon } from './icons';
import { Sheet } from './Sheet';

interface Props {
  target: Target;
  keySpec: KeySpec;
  clef: ClefId;
  naming: NoteNaming;
  degreeStyle: DegreeStyle;
  /** Low range mode: octaves down to G1 are offered. */
  lowRange?: boolean;
  onChange: (target: Target) => void;
  /** Source of the last sung note, which a fresh target starts near. */
  store?: PitchStore;
}

/**
 * Bottom-bar target button and its sheet: an on/off switch, the degrees of
 * the key as a radio group («III · ми»), an octave stepper limited to the
 * voice range and a preview of the target.
 *
 * While off, the sheet shows the target a switch-on would pick (the tonic
 * near the last sung note, or in the clef's octave), and choosing a degree or
 * an octave also switches the target on.
 */
export function TargetControls({
  target,
  keySpec,
  clef,
  naming,
  degreeStyle,
  lowRange = false,
  onChange,
  store,
}: Props) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const degreeName = useId();
  const lastMidi = store?.getNote()?.stableMidi ?? null;
  const shown = target.enabled
    ? target
    : { ...defaultTarget(keySpec, clef, lastMidi, lowRange), enabled: false };
  const note = targetNote(keySpec, shown.degree, shown.octave);
  const full = formatNote(note, naming, lang).full;
  const range = octaveRange(keySpec, shown.degree, lowRange);
  const solfegeRu = naming === 'solfege' && lang === 'ru';

  const pick = (degree: number) =>
    onChange({
      enabled: true,
      degree,
      octave: clampOctave(keySpec, degree, shown.octave, lowRange),
    });
  const step = (by: number) =>
    onChange({
      enabled: true,
      degree: shown.degree,
      octave: clampOctave(keySpec, shown.degree, shown.octave + by, lowRange),
    });

  return (
    <div className="target" data-testid="target">
      <button
        type="button"
        className={target.enabled ? 'dock-btn target-open on' : 'dock-btn target-open'}
        data-testid="target-open"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={target.enabled ? t.targetButton.replace('{value}', full) : t.targetButtonOff}
        onClick={() => setOpen(true)}
      >
        <TargetIcon />
        <span className="dock-btn-text">
          <span className="dock-btn-title">{t.target}</span>
          <span className="dock-btn-sub" data-testid="target-open-note">
            {target.enabled ? compactNote(note, naming, lang) : t.targetOff}
          </span>
        </span>
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t.targetTitle} testId="target-sheet">
        <Switch
          label={t.targetToggle}
          checked={target.enabled}
          autoFocus
          onChange={(on) =>
            onChange(on ? { ...shown, enabled: true } : { ...target, enabled: false })
          }
        />
        <div className={target.enabled ? 'target-fields' : 'target-fields off'}>
          <fieldset className="field">
            <legend>{t.targetDegree}</legend>
            <div className="degree-grid">
              {DEGREES.map((d) => {
                const n = targetNote(keySpec, d, shown.octave);
                const deg = formatDegree(d, degreeStyle);
                const name = pitchName(n, naming, lang);
                const checked = d === shown.degree;
                return (
                  <label key={d} className="degree-cell">
                    <input
                      type="radio"
                      name={degreeName}
                      checked={checked}
                      aria-label={`${deg} · ${name}`}
                      onChange={() => pick(d)}
                      // The shown degree is already checked while off: a tap still switches on.
                      onClick={() => checked && !target.enabled && pick(d)}
                    />
                    <span className="degree-cell-deg">{deg}</span>
                    <span className="degree-cell-note">{name}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <div className="field">
            <span id={`${degreeName}-octave`}>{t.targetOctave}</span>
            <div className="stepper" role="group" aria-labelledby={`${degreeName}-octave`}>
              <button
                type="button"
                className="stepper-btn"
                aria-label={t.octaveDown}
                disabled={shown.octave <= range.min}
                onClick={() => step(-1)}
              >
                ◀
              </button>
              <output className="stepper-value" data-testid="target-octave" aria-live="polite">
                {solfegeRu ? russianOctave(shown.octave) : String(shown.octave)}
              </output>
              <button
                type="button"
                className="stepper-btn"
                aria-label={t.octaveUp}
                disabled={shown.octave >= range.max}
                onClick={() => step(1)}
              >
                ▶
              </button>
            </div>
          </div>
          <p className="target-preview" data-testid="target-preview">
            {t.targetPreview.split('{note}')[0]}
            <strong>{full}</strong>
          </p>
        </div>
      </Sheet>
    </div>
  );
}

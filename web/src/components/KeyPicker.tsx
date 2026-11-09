import { useState } from 'react';
import type { KeySpec, Mode } from '../engine/types';
import { useI18n } from '../i18n/context';
import { MAJOR_KEYS, MINOR_KEYS } from '../music/keys';
import { keyLabel, pitchName, type NoteNaming } from '../music/naming';
import { keyId, keySignature, sameKey } from '../music/theory';
import { Segmented } from './controls';

interface Props {
  value: KeySpec;
  naming: NoteNaming;
  onChange: (key: KeySpec) => void;
}

/** «3♯», «2♭» or «без знаков». */
function signatureText(sig: number, none: string): string {
  if (sig === 0) return none;
  return `${Math.abs(sig)}${sig > 0 ? '♯' : '♭'}`;
}

/**
 * Key picker: major / minor switch over a 3×5 grid of the 15 keys ordered by
 * key signature (7♭ top left, no accidentals in the middle, 7♯ bottom right),
 * so a key is found by its number of sharps or flats, like on a circle of
 * fifths read in rows.
 */
export function KeyPicker({ value, naming, onChange }: Props) {
  const { t, lang } = useI18n();
  const [mode, setMode] = useState<Mode>(value.mode);
  const keys = mode === 'major' ? MAJOR_KEYS : MINOR_KEYS;

  return (
    <div className="key-picker">
      <Segmented<Mode>
        legend={t.key}
        hideLegend
        value={mode}
        onChange={setMode}
        options={[
          { value: 'major', label: t.major },
          { value: 'minor', label: t.minor },
        ]}
      />
      <div className="key-grid" role="group" aria-label={mode === 'major' ? t.major : t.minor}>
        {keys.map((k) => {
          const selected = sameKey(k, value);
          const sig = keySignature(k);
          const name = pitchName({ letter: k.tonic, accidental: k.accidental }, naming, lang);
          return (
            <button
              key={keyId(k)}
              type="button"
              className="key-cell"
              aria-pressed={selected}
              aria-label={keyLabel(k, lang)}
              data-autofocus={selected || undefined}
              data-sig={Math.sign(sig)}
              onClick={() => onChange(k)}
            >
              <span className="key-cell-name">
                {mode === 'major' ? name[0].toUpperCase() + name.slice(1) : name}
              </span>
              <span className="key-cell-sig">{signatureText(sig, t.noSignature)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

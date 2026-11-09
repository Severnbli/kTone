import type { ClefId } from '../engine/types';
import { useI18n } from '../i18n/context';
import { CLEFS } from '../settings';
import { CLEF_LABEL_KEY } from './clefLabels';

// U+1D11E G clef, U+1D122 F clef, U+1D121 C clef (as on the staff).
const CLEF_CHAR: Record<ClefId, string> = {
  treble: '\u{1D11E}',
  treble8vb: '\u{1D11E}',
  bass: '\u{1D122}',
  alto: '\u{1D121}',
  tenor: '\u{1D121}',
};

/** The clef sign as text (decorative); the treble 8vb clef gets a small 8 below. */
export function ClefGlyph({ clef }: { clef: ClefId }) {
  return (
    <span className="clef-sign" aria-hidden="true">
      {CLEF_CHAR[clef]}
      {clef === 'treble8vb' && <span className="clef-sign-8">8</span>}
    </span>
  );
}

interface Props {
  value: ClefId;
  onChange: (clef: ClefId) => void;
}

/** List of the five clefs with their signs. */
export function ClefPicker({ value, onChange }: Props) {
  const { t } = useI18n();
  return (
    <div className="clef-list" role="group" aria-label={t.clef}>
      {CLEFS.map((c) => (
        <button
          key={c}
          type="button"
          className="clef-option"
          aria-pressed={c === value}
          data-autofocus={c === value || undefined}
          onClick={() => onChange(c)}
        >
          <ClefGlyph clef={c} />
          <span className="clef-option-name">{t[CLEF_LABEL_KEY[c]]}</span>
        </button>
      ))}
    </div>
  );
}

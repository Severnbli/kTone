import { useSyncExternalStore } from 'react';
import type { ClefId, SpelledNote } from '../engine/types';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { accidentalGlyph } from '../music/naming';
import { ledgerLines, signatureAccidental, signatureLayout } from '../music/theory';

// Geometry: one staff step (line to adjacent space) = STEP px.
const STEP = 5;
const BOTTOM_Y = 100; // y of step 0 (bottom line)
const WIDTH = 230;
const HEIGHT = 160;
const SIG_X = 52;
const SIG_DX = 9;
const NOTE_X = 175;
const MUSIC_FONT = "'Bravura Text', 'Noto Music', 'Segoe UI Symbol', 'Apple Symbols', serif";

const y = (step: number) => BOTTOM_Y - step * STEP;
const clampStep = (step: number) => Math.max(-11, Math.min(19, step));

interface ClefGlyph {
  char: string;
  /** Staff step the glyph's baseline is placed at. */
  baseline: number;
  size: number;
  octaveBelow?: boolean;
}

// Unicode musical symbols (U+1D11E G clef, U+1D121 C clef, U+1D122 F clef),
// positioned so the clef's reference line falls on the right staff line.
const CLEF_GLYPHS: Record<ClefId, ClefGlyph> = {
  treble: { char: '\u{1D11E}', baseline: -1.4, size: 58 },
  treble8vb: { char: '\u{1D11E}', baseline: -1.4, size: 58, octaveBelow: true },
  bass: { char: '\u{1D122}', baseline: 2.0, size: 46 },
  alto: { char: '\u{1D121}', baseline: 0, size: 40 },
  tenor: { char: '\u{1D121}', baseline: 2, size: 40 },
};

export interface StaffProps {
  clef: ClefId;
  /** Sharps (positive) or flats (negative). */
  signature: number;
  note: SpelledNote | null;
  staffStep: number;
  active?: boolean;
  label?: string;
}

export function StaffView({ clef, signature, note, staffStep, active = true, label }: StaffProps) {
  const glyph = CLEF_GLYPHS[clef];
  const sig = signatureLayout(signature, clef);
  const step = clampStep(staffStep);
  const needsAccidental = note && note.accidental !== signatureAccidental(signature, note.letter);

  return (
    <svg
      className="staff"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label={label}
      data-testid="staff"
      data-clef={clef}
    >
      <g className="staff-lines">
        {[0, 2, 4, 6, 8].map((s) => (
          <line key={s} x1={4} x2={WIDTH - 4} y1={y(s)} y2={y(s)} />
        ))}
      </g>
      <text
        className="clef-glyph"
        x={8}
        y={y(glyph.baseline)}
        fontSize={glyph.size}
        fontFamily={MUSIC_FONT}
        data-testid="clef"
      >
        {glyph.char}
      </text>
      {glyph.octaveBelow && (
        <text className="clef-octave" x={22} y={y(-5.5)} fontSize={11} textAnchor="middle">
          8
        </text>
      )}
      {sig.map((g, i) => (
        <text
          key={i}
          className="sig-accidental"
          data-testid="signature-accidental"
          x={SIG_X + i * SIG_DX}
          y={y(g.step) + (g.accidental > 0 ? 6 : 4)}
          fontSize={20}
          fontFamily={MUSIC_FONT}
          textAnchor="middle"
        >
          {accidentalGlyph(g.accidental)}
        </text>
      ))}
      {note && (
        <g className={active ? 'staff-note' : 'staff-note inactive'} data-testid="staff-note">
          {ledgerLines(step).map((s) => (
            <line
              key={s}
              className="ledger-line"
              data-testid="ledger-line"
              x1={NOTE_X - 12}
              x2={NOTE_X + 12}
              y1={y(s)}
              y2={y(s)}
            />
          ))}
          {needsAccidental && (
            <text
              className="note-accidental-glyph"
              data-testid="note-accidental"
              x={NOTE_X - 16}
              y={y(step) + 6}
              fontSize={20}
              fontFamily={MUSIC_FONT}
              textAnchor="middle"
            >
              {note.accidental === 0 ? '♮' : accidentalGlyph(note.accidental)}
            </text>
          )}
          <ellipse
            className="note-head"
            data-testid="note-head"
            cx={NOTE_X}
            cy={y(step)}
            rx={6.5}
            ry={4.6}
            transform={`rotate(-20 ${NOTE_X} ${y(step)})`}
          />
        </g>
      )}
    </svg>
  );
}

interface LiveProps {
  store: PitchStore;
  clef: ClefId;
  signature: number;
}

/** Staff bound to the store; re-renders only when the displayed note changes. */
export function Staff({ store, clef, signature }: LiveProps) {
  const { t } = useI18n();
  const snap = useSyncExternalStore(store.subscribeNote, store.getNote);
  return (
    <StaffView
      clef={clef}
      signature={signature}
      note={snap?.note ?? null}
      staffStep={snap?.staffStep ?? 0}
      active={snap?.active ?? false}
      label={t.staff}
    />
  );
}

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { formatDegree, formatNote, type DegreeStyle, type NoteNaming } from '../music/naming';

const HZ_REFRESH_MS = 100;

interface Props {
  store: PitchStore;
  naming: NoteNaming;
  degreeStyle: DegreeStyle;
  hint: string;
}

export function NoteDisplay({ store, naming, degreeStyle, hint }: Props) {
  const { t, lang } = useI18n();
  const snap = useSyncExternalStore(store.subscribeNote, store.getNote);
  const hzRef = useRef<HTMLSpanElement>(null);

  // The frequency changes every frame: write it straight to the DOM, throttled.
  useEffect(() => {
    let last = -Infinity;
    return store.subscribeFrame((frame) => {
      const el = hzRef.current;
      if (!el) return;
      const now = performance.now();
      if (frame && now - last < HZ_REFRESH_MS) return;
      last = now;
      el.textContent = frame ? frame.frequencyHz.toFixed(1) : '–';
    });
  }, [store]);

  const f = snap ? formatNote(snap.note, naming, lang) : null;
  const solfegeRu = naming === 'solfege' && lang === 'ru';
  const classes = ['note-display'];
  if (snap && !snap.inKey) classes.push('out-of-key');
  if (!snap?.active) classes.push('inactive');

  // Only the note itself is a live region: the frequency changes ten times a
  // second and would make a screen reader talk non-stop.
  return (
    <section className={classes.join(' ')} data-testid="note-display">
      <div className="note-live" aria-live="polite" aria-atomic="true">
        {f && snap ? (
          <>
            <div className="note-name" data-testid="note-name" aria-label={f.full}>
              <span className="note-letter">{f.name}</span>
              {f.accidental && <span className="note-accidental">{f.accidental}</span>}
              {!solfegeRu && <sub className="note-octave-num">{f.octave}</sub>}
            </div>
            {solfegeRu && (
              <div className="note-octave" data-testid="note-octave">
                {f.octave}
              </div>
            )}
            <div className="note-degree" data-testid="note-degree">
              {snap.degree !== null ? (
                <>
                  {t.degree} <strong>{formatDegree(snap.degree, degreeStyle)}</strong>
                </>
              ) : (
                <span className="out-of-key-label">{t.outOfKey}</span>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="note-name placeholder" data-testid="note-name">
              –
            </div>
            <div className="note-hint">{hint}</div>
          </>
        )}
      </div>
      <div className="note-hz">
        <span ref={hzRef} data-testid="note-hz">
          –
        </span>{' '}
        {t.hz}
      </div>
    </section>
  );
}

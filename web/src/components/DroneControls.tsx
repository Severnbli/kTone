import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Drone, droneMidi } from '../audio/drone';
import { documentVisibility, watchVisibility, type PageVisibility } from '../audio/lifecycle';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { formatNote, octaveShort, type NoteNaming } from '../music/naming';
import { LETTER_PC, midiToHz } from '../music/theory';
import type { Settings } from '../settings';
import { DroneFields } from './DroneFields';
import { DroneLeakHint } from './DroneLeakHint';
import { DroneIcon, PlayIcon, StopIcon } from './icons';
import { Sheet } from './Sheet';

interface Props {
  settings: Settings;
  naming: NoteNaming;
  onChange: (drone: Settings['drone']) => void;
  /**
   * Called with the drone frequency when it starts playing and whenever that
   * changes, and with null when it stops (on a tap, an interruption or in the
   * background). Fires as soon as the drone is switched on, before its audio
   * starts, so the analyzer knows the drone before the mic can hear it.
   */
  onPlayingChange?: (hz: number | null) => void;
  /** Source of the drone leak hint. */
  store?: PitchStore;
  visibility?: PageVisibility;
  createDrone?: () => Drone;
  /** Where status messages go (the toast area above the bottom bar); inline when absent. */
  toastHost?: HTMLElement | null;
}

const defaultVisibility = documentVisibility();

// Lifecycle: when the system pauses the drone's AudioContext, try one resume
// while the page is visible (now or on return); if that fails, or the page
// stays hidden for BACKGROUND_STOP_MS, stop the drone and say why. Tapping the
// button again restarts it from a user gesture.
export function DroneControls({
  settings,
  naming,
  onChange,
  onPlayingChange,
  store,
  visibility = defaultVisibility,
  createDrone = () => new Drone(),
  toastHost,
}: Props) {
  const { t, lang } = useI18n();
  const droneRef = useRef<Drone | null>(null);
  const [on, setOn] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const { key, a4Hz } = settings;
  const { volume, octave } = settings.drone;
  const midi = droneMidi(LETTER_PC[key.tonic], key.accidental, octave);
  const hz = midiToHz(midi, a4Hz);
  const tonicNote = { letter: key.tonic, accidental: key.accidental, octave };
  const label = formatNote(tonicNote, naming, lang);
  // «до · малая» fits the bottom bar on a 360 px phone; «C3» is short already.
  const shortLabel =
    naming === 'solfege' && lang === 'ru'
      ? `${label.short} · ${octaveShort(tonicNote, naming, lang)}`
      : label.full;

  useEffect(() => {
    if (on) droneRef.current?.setFrequency(hz);
  }, [on, hz]);
  useEffect(() => {
    if (on) droneRef.current?.setVolume(volume);
  }, [on, volume]);
  useEffect(
    () => () => {
      void droneRef.current?.dispose();
    },
    [],
  );

  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  useEffect(() => {
    onPlayingChangeRef.current?.(on ? hz : null);
  }, [on, hz]);

  const halt = useCallback((reason: 'interrupted' | null) => {
    droneRef.current?.stop();
    setOn(false);
    setInterrupted(reason === 'interrupted');
  }, []);

  const recover = useCallback(async () => {
    const drone = droneRef.current;
    if (!drone?.paused || visibility.hidden) return;
    if (!(await drone.resume()) && droneRef.current === drone && drone.playing) {
      halt('interrupted');
    }
  }, [visibility, halt]);

  useEffect(() => {
    const drone = droneRef.current;
    if (!on || !drone) return;
    drone.onPause = () => void recover();
    const unwatch = watchVisibility(visibility, {
      onHiddenTimeout: () => halt(null),
      onVisible: () => void recover(),
    });
    return () => {
      drone.onPause = null;
      unwatch();
    };
  }, [on, visibility, recover, halt]);

  const toggle = () => {
    droneRef.current ??= createDrone();
    const drone = droneRef.current;
    if (on) {
      halt(null);
    } else {
      setInterrupted(false);
      setOn(true);
      void drone.start(hz, volume).then(() => recover());
    }
  };

  const leakHint = on && store ? <DroneLeakHint store={store} /> : null;
  const toast = (node: ReactNode) => (toastHost ? createPortal(node, toastHost) : node);
  const state = on ? t.droneStateOn : t.droneStateOff;

  return (
    <div className="drone" data-testid="drone">
      <button
        type="button"
        className={on ? 'dock-btn drone-open on' : 'dock-btn drone-open'}
        data-testid="drone-open"
        aria-haspopup="dialog"
        aria-expanded={sheetOpen}
        aria-label={`${t.drone} · ${label.full}, ${state}`}
        onClick={() => setSheetOpen(true)}
      >
        <DroneIcon />
        <span className="dock-btn-text">
          <span className="dock-btn-title">{t.drone}</span>
          <span className="dock-btn-sub">{shortLabel}</span>
        </span>
      </button>
      <Sheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={t.drone}
        testId="drone-sheet"
      >
        <button
          type="button"
          className={on ? 'drone-toggle on' : 'drone-toggle'}
          aria-pressed={on}
          data-testid="drone-toggle"
          data-autofocus
          onClick={toggle}
        >
          <span className="drone-toggle-icon">{on ? <StopIcon /> : <PlayIcon />}</span>
          <span className="drone-toggle-label">
            {t.drone} · {label.full}
          </span>
          <span className="drone-toggle-state" aria-hidden="true">
            {state}
          </span>
        </button>
        <DroneFields drone={settings.drone} keySpec={key} naming={naming} onChange={onChange} />
        <p className={on ? 'warning active' : 'warning'}>{t.droneWarning}</p>
        {leakHint}
      </Sheet>
      {interrupted &&
        toast(
          <p className="toast error" role="status" data-testid="drone-interrupted">
            {t.droneInterrupted}
          </p>,
        )}
      {!sheetOpen && leakHint && toast(leakHint)}
    </div>
  );
}

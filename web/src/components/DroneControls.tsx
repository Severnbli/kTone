import { useCallback, useEffect, useRef, useState } from 'react';
import { Drone, droneMidi } from '../audio/drone';
import { documentVisibility, watchVisibility, type PageVisibility } from '../audio/lifecycle';
import { useI18n } from '../i18n/context';
import { formatNote, type NoteNaming } from '../music/naming';
import { LETTER_PC, midiToHz } from '../music/theory';
import { DRONE_OCTAVES, type Settings } from '../settings';

interface Props {
  settings: Settings;
  naming: NoteNaming;
  onChange: (drone: Settings['drone']) => void;
  /** Called when the drone starts or stops (e.g. to hold a screen wake lock). */
  onPlayingChange?: (playing: boolean) => void;
  visibility?: PageVisibility;
  createDrone?: () => Drone;
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
  visibility = defaultVisibility,
  createDrone = () => new Drone(),
}: Props) {
  const { t, lang } = useI18n();
  const droneRef = useRef<Drone | null>(null);
  const [on, setOn] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const { key, a4Hz } = settings;
  const { volume, octave } = settings.drone;
  const midi = droneMidi(LETTER_PC[key.tonic], key.accidental, octave);
  const hz = midiToHz(midi, a4Hz);
  const label = formatNote({ letter: key.tonic, accidental: key.accidental, octave }, naming, lang);

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
    onPlayingChangeRef.current?.(on);
  }, [on]);

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

  return (
    <section className="drone" data-testid="drone">
      <button
        type="button"
        className={on ? 'btn drone-toggle on' : 'btn drone-toggle'}
        aria-pressed={on}
        onClick={toggle}
      >
        {on ? t.droneOn : t.droneOff}
        <span className="drone-note"> · {label.full}</span>
      </button>
      <div className="drone-row">
        <label className="field inline">
          <span>{t.droneVolume}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            aria-label={t.droneVolume}
            onChange={(e) => onChange({ octave, volume: Number(e.target.value) })}
          />
        </label>
        <label className="field inline">
          <span>{t.droneOctave}</span>
          <select
            aria-label={t.droneOctave}
            value={octave}
            onChange={(e) => onChange({ volume, octave: Number(e.target.value) })}
          >
            {DRONE_OCTAVES.map((o) => (
              <option key={o} value={o}>
                {
                  formatNote(
                    { letter: key.tonic, accidental: key.accidental, octave: o },
                    naming,
                    lang,
                  ).full
                }
              </option>
            ))}
          </select>
        </label>
      </div>
      {interrupted && (
        <p className="error" role="status" data-testid="drone-interrupted">
          {t.droneInterrupted}
        </p>
      )}
      <p className={on ? 'warning active' : 'warning'}>{t.droneWarning}</p>
    </section>
  );
}

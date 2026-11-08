import { useEffect, useRef, useState } from 'react';
import { Drone, droneMidi } from '../audio/drone';
import type { PitchStore } from '../audio/pitchStore';
import { useI18n } from '../i18n/context';
import { formatNote, type NoteNaming } from '../music/naming';
import { LETTER_PC, midiToHz } from '../music/theory';
import { DRONE_OCTAVES, type Settings } from '../settings';
import { DroneLeakHint } from './DroneLeakHint';

interface Props {
  settings: Settings;
  naming: NoteNaming;
  onChange: (drone: Settings['drone']) => void;
  /** Called with the drone frequency while it plays, null when it stops. */
  onPlayingChange?: (hz: number | null) => void;
  /** Source of the drone leak hint. */
  store?: PitchStore;
}

export function DroneControls({ settings, naming, onChange, onPlayingChange, store }: Props) {
  const { t, lang } = useI18n();
  const droneRef = useRef<Drone | null>(null);
  const [on, setOn] = useState(false);
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
  useEffect(() => {
    onPlayingChange?.(on ? hz : null);
  }, [on, hz, onPlayingChange]);
  useEffect(
    () => () => {
      void droneRef.current?.dispose();
    },
    [],
  );

  const toggle = () => {
    droneRef.current ??= new Drone();
    if (on) {
      droneRef.current.stop();
      setOn(false);
    } else {
      void droneRef.current.start(hz, volume);
      setOn(true);
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
      <p className={on ? 'warning active' : 'warning'}>{t.droneWarning}</p>
      {on && store && <DroneLeakHint store={store} />}
    </section>
  );
}

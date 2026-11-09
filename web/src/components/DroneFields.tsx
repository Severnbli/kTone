import type { KeySpec } from '../engine/types';
import { useI18n } from '../i18n/context';
import { formatNote, octaveShort, type NoteNaming } from '../music/naming';
import { DRONE_OCTAVES, type Settings } from '../settings';
import { Segmented } from './controls';

interface Props {
  drone: Settings['drone'];
  keySpec: KeySpec;
  naming: NoteNaming;
  onChange: (drone: Settings['drone']) => void;
  /** Say «drone» in the labels (outside the drone sheet). */
  standalone?: boolean;
}

/** Drone octave (segmented) and volume (slider); shared by the drone sheet and settings. */
export function DroneFields({ drone, keySpec, naming, onChange, standalone = false }: Props) {
  const { t, lang } = useI18n();
  const { volume, octave } = drone;
  const octaveLabel = standalone ? t.droneOctaveLong : t.droneOctave;
  const volumeLabel = standalone ? t.droneVolumeLong : t.droneVolume;
  return (
    <>
      <Segmented<number>
        legend={octaveLabel}
        value={octave}
        onChange={(o) => onChange({ volume, octave: o })}
        options={DRONE_OCTAVES.map((o) => {
          const note = { letter: keySpec.tonic, accidental: keySpec.accidental, octave: o };
          return {
            value: o,
            label: octaveShort(note, naming, lang),
            ariaLabel: formatNote(note, naming, lang).full,
          };
        })}
      />
      <label className="field">
        <span>{volumeLabel}</span>
        <input
          type="range"
          className="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          aria-label={volumeLabel}
          onChange={(e) => onChange({ octave, volume: Number(e.target.value) })}
        />
      </label>
    </>
  );
}

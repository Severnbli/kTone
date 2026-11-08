import { useEffect, useState } from 'react';
import {
  listAudioInputs,
  resolveDeviceId,
  type AudioInputs,
  type MediaDevicesLike,
} from '../audio/devices';
import { useI18n } from '../i18n/context';

interface Props {
  /** Saved `deviceId`; `''` is the system default. */
  value: string;
  onChange: (deviceId: string) => void;
  mediaDevices: MediaDevicesLike | null;
}

/** Microphone picker. Refreshes on mount and on `devicechange`. */
export function MicDeviceSelect({ value, onChange, mediaDevices }: Props) {
  const { t } = useI18n();
  const [loaded, setList] = useState<AudioInputs | null>(null);

  useEffect(() => {
    if (!mediaDevices) return;
    let alive = true;
    const refresh = () => {
      listAudioInputs(mediaDevices).then(
        (next) => alive && setList(next),
        () => undefined,
      );
    };
    refresh();
    mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      alive = false;
      mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, [mediaDevices]);

  if (!mediaDevices) return null;
  // Until the first listing arrives, treat the list as unknown (like locked).
  const list = loaded ?? { inputs: [], locked: true };
  const shown = resolveDeviceId(value, list);
  const known = shown === '' || list.inputs.some((d) => d.deviceId === shown);
  const missing = value !== '' && shown === '';

  return (
    <label className="field">
      <span>{t.micDevice}</span>
      <select
        aria-label={t.micDevice}
        value={known ? shown : ''}
        onChange={(e) => onChange(e.target.value)}
        data-testid="mic-device"
      >
        <option value="">{t.micDefault}</option>
        {list.inputs.map((d, i) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || t.micNumbered.replace('{n}', String(i + 1))}
          </option>
        ))}
      </select>
      {loaded?.locked && <small className="field-note">{t.micDevicesLocked}</small>}
      {missing && <small className="field-note">{t.micDeviceMissing}</small>}
    </label>
  );
}

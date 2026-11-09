import { useEffect, useState } from 'react';
import { browserMediaDevices, type MediaDevicesLike } from '../audio/devices';
import type { ClefId } from '../engine/types';
import { useI18n } from '../i18n/context';
import type { Strings } from '../i18n/strings';
import { MAJOR_KEYS, MINOR_KEYS } from '../music/keys';
import { keyLabel } from '../music/naming';
import { keyId, parseKeyId } from '../music/theory';
import { A4_MAX, A4_MIN, CLEFS, sanitizeSettings, type Settings } from '../settings';
import { MicDeviceSelect } from './MicDeviceSelect';

const CLEF_LABEL_KEY: Record<ClefId, keyof Strings> = {
  treble: 'clefTreble',
  treble8vb: 'clefTreble8vb',
  bass: 'clefBass',
  alto: 'clefAlto',
  tenor: 'clefTenor',
};

interface Props {
  settings: Settings;
  onChange: (next: Settings) => void;
  /** For the microphone picker; defaults to `navigator.mediaDevices`, `null` hides it. */
  mediaDevices?: MediaDevicesLike | null;
}

/** Number input that only commits valid values, so typing "4" on the way to "442" is fine. */
function NumberField({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(v) && v >= min && v <= max) onCommit(v);
        }}
        onBlur={() => setText(String(value))}
      />
    </label>
  );
}

export function SettingsPanel({ settings, onChange, mediaDevices = browserMediaDevices() }: Props) {
  const { t, lang } = useI18n();
  const update = (patch: Partial<Settings>) =>
    onChange(sanitizeSettings({ ...settings, ...patch }));

  return (
    <form className="settings" onSubmit={(e) => e.preventDefault()} data-testid="settings-panel">
      <MicDeviceSelect
        value={settings.micDeviceId}
        onChange={(micDeviceId) => update({ micDeviceId })}
        mediaDevices={mediaDevices}
      />

      <label className="field">
        <span>{t.key}</span>
        <select
          aria-label={t.key}
          value={keyId(settings.key)}
          onChange={(e) => {
            const key = parseKeyId(e.target.value);
            if (key) update({ key });
          }}
        >
          <optgroup label={t.major}>
            {MAJOR_KEYS.map((k) => (
              <option key={keyId(k)} value={keyId(k)}>
                {keyLabel(k, lang)}
              </option>
            ))}
          </optgroup>
          <optgroup label={t.minor}>
            {MINOR_KEYS.map((k) => (
              <option key={keyId(k)} value={keyId(k)}>
                {keyLabel(k, lang)}
              </option>
            ))}
          </optgroup>
        </select>
      </label>

      <label className="field">
        <span>{t.clef}</span>
        <select
          aria-label={t.clef}
          value={settings.clef}
          onChange={(e) => update({ clef: e.target.value as ClefId })}
        >
          {CLEFS.map((c) => (
            <option key={c} value={c}>
              {t[CLEF_LABEL_KEY[c]]}
            </option>
          ))}
        </select>
      </label>

      <NumberField
        id="a4"
        label={t.a4}
        value={settings.a4Hz}
        min={A4_MIN}
        max={A4_MAX}
        onCommit={(a4Hz) => update({ a4Hz })}
      />

      <fieldset className="field">
        <legend>{t.naming}</legend>
        <label className="radio">
          <input
            type="radio"
            name="naming"
            checked={settings.naming === 'solfege'}
            onChange={() => update({ naming: 'solfege' })}
          />
          {t.namingSolfege}
        </label>
        <label className="radio">
          <input
            type="radio"
            name="naming"
            checked={settings.naming === 'letter'}
            onChange={() => update({ naming: 'letter' })}
          />
          {t.namingLetter}
        </label>
      </fieldset>

      <fieldset className="field">
        <legend>{t.degrees}</legend>
        <label className="radio">
          <input
            type="radio"
            name="degrees"
            checked={settings.degreeStyle === 'roman'}
            onChange={() => update({ degreeStyle: 'roman' })}
          />
          {t.degreesRoman}
        </label>
        <label className="radio">
          <input
            type="radio"
            name="degrees"
            checked={settings.degreeStyle === 'arabic'}
            onChange={() => update({ degreeStyle: 'arabic' })}
          />
          {t.degreesArabic}
        </label>
      </fieldset>

      <fieldset className="field zones">
        <legend>{t.zones}</legend>
        <NumberField
          id="zone-green"
          label={t.zoneGreen}
          value={settings.zones.green}
          min={1}
          max={49}
          onCommit={(green) =>
            update({ zones: { green, yellow: Math.max(green, settings.zones.yellow) } })
          }
        />
        <NumberField
          id="zone-yellow"
          label={t.zoneYellow}
          value={settings.zones.yellow}
          min={settings.zones.green}
          max={50}
          onCommit={(yellow) => update({ zones: { ...settings.zones, yellow } })}
        />
      </fieldset>

      <label className="check">
        <input
          type="checkbox"
          checked={settings.droneFilter}
          onChange={(e) => update({ droneFilter: e.target.checked })}
        />
        {t.droneFilter}
      </label>

      <label className="field">
        <span>{t.language}</span>
        <select
          aria-label={t.language}
          value={settings.lang}
          onChange={(e) => update({ lang: e.target.value === 'en' ? 'en' : 'ru' })}
        >
          <option value="ru">Русский</option>
          <option value="en">English</option>
        </select>
      </label>
    </form>
  );
}

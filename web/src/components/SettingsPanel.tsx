import { useEffect, useState, type ReactNode } from 'react';
import { browserMediaDevices, type MediaDevicesLike } from '../audio/devices';
import { useI18n } from '../i18n/context';
import type { Lang } from '../i18n/strings';
import type { DegreeStyle, NoteNaming } from '../music/naming';
import { A4_MAX, A4_MIN, sanitizeSettings, type Settings, type Theme } from '../settings';
import { Segmented, Switch } from './controls';
import { DroneFields } from './DroneFields';
import { MicDeviceSelect } from './MicDeviceSelect';

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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/**
 * Everything except key and clef (those are the header chips), grouped:
 * sound, notation, accuracy, interface.
 */
export function SettingsPanel({ settings, onChange, mediaDevices = browserMediaDevices() }: Props) {
  const { t } = useI18n();
  const update = (patch: Partial<Settings>) =>
    onChange(sanitizeSettings({ ...settings, ...patch }));

  return (
    <form className="settings" onSubmit={(e) => e.preventDefault()} data-testid="settings-panel">
      <Group title={t.groupSound}>
        <MicDeviceSelect
          value={settings.micDeviceId}
          onChange={(micDeviceId) => update({ micDeviceId })}
          mediaDevices={mediaDevices}
        />
        <Switch
          label={t.droneFilter}
          checked={settings.droneFilter}
          onChange={(droneFilter) => update({ droneFilter })}
        />
        <DroneFields
          drone={settings.drone}
          keySpec={settings.key}
          naming={settings.naming}
          onChange={(drone) => update({ drone })}
          standalone
        />
      </Group>

      <Group title={t.groupNotation}>
        <Segmented<NoteNaming>
          legend={t.naming}
          value={settings.naming}
          onChange={(naming) => update({ naming })}
          options={[
            { value: 'solfege', label: t.namingSolfege },
            { value: 'letter', label: t.namingLetter },
          ]}
        />
        <small className="field-note">{t.namingNote}</small>
        <Segmented<DegreeStyle>
          legend={t.degrees}
          value={settings.degreeStyle}
          onChange={(degreeStyle) => update({ degreeStyle })}
          options={[
            { value: 'roman', label: t.degreesRoman },
            { value: 'arabic', label: t.degreesArabic },
          ]}
        />
        <NumberField
          id="a4"
          label={t.a4}
          value={settings.a4Hz}
          min={A4_MIN}
          max={A4_MAX}
          onCommit={(a4Hz) => update({ a4Hz })}
        />
      </Group>

      <Group title={t.groupAccuracy}>
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
      </Group>

      <Group title={t.groupInterface}>
        <Segmented<Lang>
          legend={t.language}
          value={settings.lang}
          onChange={(lang) => update({ lang })}
          options={[
            { value: 'ru', label: 'Русский' },
            { value: 'en', label: 'English' },
          ]}
        />
        <Segmented<Theme>
          legend={t.theme}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
          testId="theme-setting"
          options={[
            { value: 'system', label: t.themeSystem },
            { value: 'dark', label: t.themeDark },
            { value: 'light', label: t.themeLight },
          ]}
        />
      </Group>
    </form>
  );
}

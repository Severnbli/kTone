import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createAnalyzer } from './engine';
import type { AnalyzerFactory } from './engine/types';
import type { MediaDevicesLike } from './audio/devices';
import { DebugStats, debugRequested } from './audio/debugStats';
import { LevelStore } from './audio/level';
import { documentVisibility, type PageVisibility } from './audio/lifecycle';
import { MicError, startMic as realStartMic, type MicErrorCode, type StartMic } from './audio/mic';
import { PitchEngine, type EngineState } from './audio/pitchEngine';
import { PitchStore } from './audio/pitchStore';
import { browserWakeLock, ScreenWakeLock, type WakeLockApi } from './audio/wakeLock';
import { CentsGauge } from './components/CentsGauge';
import { ClefGlyph, ClefPicker } from './components/ClefPicker';
import { CLEF_LABEL_KEY } from './components/clefLabels';
import { DroneControls } from './components/DroneControls';
import { SOURCE_URL } from './buildInfo';
import {
  ChevronDownIcon,
  GearIcon,
  GitHubIcon,
  MicIcon,
  StopIcon,
  TargetIcon,
} from './components/icons';
import { KeyPicker } from './components/KeyPicker';
import { DebugOverlay } from './components/DebugOverlay';
import { LevelMeter } from './components/LevelMeter';
import { NoteDisplay } from './components/NoteDisplay';
import { PitchCurve } from './components/PitchCurve';
import { SettingsPanel } from './components/SettingsPanel';
import { Sheet } from './components/Sheet';
import { Staff } from './components/Staff';
import { FEATURES } from './features';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18n } from './i18n/context';
import type { Strings } from './i18n/strings';
import { keyLabel } from './music/naming';
import { keySignature } from './music/theory';
import { loadSettings, saveSettings, type Settings, type Theme } from './settings';

type Status =
  | 'idle'
  | 'starting'
  | 'running'
  | 'suspended'
  | 'ended'
  | 'background'
  | MicErrorCode
  | 'engine';

const ERROR_TEXT: Partial<Record<Status, keyof Strings>> = {
  denied: 'micDenied',
  notFound: 'micNotFound',
  unsupported: 'micUnsupported',
  error: 'micError',
  engine: 'engineError',
  ended: 'micEnded',
  background: 'micBackground',
  suspended: 'micPaused',
};

function statusOf(state: EngineState): Status {
  if (state.status !== 'idle') return state.status;
  return state.stopReason === 'ended' || state.stopReason === 'background'
    ? state.stopReason
    : 'idle';
}

export interface AppProps {
  factory?: AnalyzerFactory;
  startMic?: StartMic;
  initialSettings?: Settings;
  /** Page visibility; defaults to `document`. */
  visibility?: PageVisibility;
  /** Screen Wake Lock API; defaults to `navigator.wakeLock`, `null` disables it. */
  wakeLock?: WakeLockApi | null;
  /** For the microphone picker; defaults to `navigator.mediaDevices`. */
  mediaDevices?: MediaDevicesLike | null;
  /** Shows the latency overlay; defaults to `?debug` in the page URL. */
  debug?: boolean;
}

const defaultVisibility = documentVisibility();

export default function App(props: AppProps) {
  const [settings, setSettings] = useState<Settings>(() => props.initialSettings ?? loadSettings());
  useEffect(() => {
    saveSettings(settings);
    document.documentElement.lang = settings.lang;
  }, [settings]);
  // Before paint, so a saved light theme never flashes dark.
  useLayoutEffect(() => applyTheme(settings.theme), [settings.theme]);
  return (
    <I18nProvider lang={settings.lang}>
      <Main {...props} settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}

/** `system` removes the attribute and lets `prefers-color-scheme` decide (see styles.css). */
function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
}

type SheetId = 'settings' | 'key' | 'clef' | null;

function Main({
  factory = createAnalyzer,
  startMic = realStartMic,
  visibility = defaultVisibility,
  wakeLock: wakeLockApi,
  mediaDevices,
  debug = debugRequested(window.location.search),
  settings,
  setSettings,
}: AppProps & { settings: Settings; setSettings: (s: Settings) => void }) {
  const { t, lang } = useI18n();
  const store = useMemo(() => new PitchStore(), []);
  const levels = useMemo(() => new LevelStore(), []);
  const debugStats = useMemo(() => (debug ? new DebugStats() : null), [debug]);
  const engineRef = useRef<PitchEngine | null>(null);
  engineRef.current ??= new PitchEngine(store, {
    factory,
    startMic,
    now: () => performance.now(),
    visibility,
    levels,
    debug: debugStats ?? undefined,
  });
  const [status, setStatus] = useState<Status>('idle');

  // Engine-driven changes: interruptions, mic loss, background stop.
  useEffect(() => {
    const engine = engineRef.current;
    return engine?.subscribe((state) => setStatus(statusOf(state)));
  }, []);

  const wakeLockRef = useRef<ScreenWakeLock | null>(null);
  useEffect(() => {
    const lock = new ScreenWakeLock(
      wakeLockApi === undefined ? browserWakeLock() : wakeLockApi,
      visibility,
    );
    wakeLockRef.current = lock;
    return () => {
      lock.dispose();
      wakeLockRef.current = null;
    };
  }, [wakeLockApi, visibility]);
  useEffect(() => {
    wakeLockRef.current?.set('mic', status === 'running');
  }, [status]);
  // The drone the analyzer must not take for a voice (null while it is off).
  const [droneHz, setDroneHz] = useState<number | null>(null);
  const onDronePlaying = useCallback((hz: number | null) => {
    wakeLockRef.current?.set('drone', hz !== null);
    setDroneHz(hz);
  }, []);
  const [sheet, setSheet] = useState<SheetId>(null);
  const closeSheet = useCallback(() => setSheet(null), []);
  // Status messages from child components are portalled into the toast area.
  const [toastHost, setToastHost] = useState<HTMLDivElement | null>(null);

  const { key, clef, a4Hz } = settings;
  const analyzerSettings = useMemo(() => ({ key, clef, a4Hz }), [key, clef, a4Hz]);
  const analyzerSettingsRef = useRef(analyzerSettings);
  useEffect(() => {
    analyzerSettingsRef.current = analyzerSettings;
    engineRef.current?.configure(analyzerSettings);
  }, [analyzerSettings]);

  // The chosen microphone; switching it while listening restarts the session.
  const { micDeviceId } = settings;
  useEffect(() => {
    engineRef.current?.setDevice(micDeviceId).catch((err: unknown) => {
      setStatus(err instanceof MicError ? err.code : 'engine');
    });
  }, [micDeviceId]);

  useEffect(() => {
    engineRef.current?.setDrone(droneHz, settings.droneFilter);
  }, [droneHz, settings.droneFilter]);

  useEffect(() => {
    const engine = engineRef.current;
    return () => {
      void engine?.stop();
    };
  }, []);

  const toggle = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.running) {
      await engine.stop();
      setStatus('idle');
      return;
    }
    setStatus('starting');
    try {
      await engine.start(analyzerSettingsRef.current);
      setStatus(statusOf(engine.state));
    } catch (err) {
      setStatus(err instanceof MicError ? err.code : 'engine');
    }
  }, []);

  const resume = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.resume();
      setStatus(statusOf(engine.state));
    } catch (err) {
      setStatus(err instanceof MicError ? err.code : 'engine');
    }
  }, []);

  const signature = keySignature(key);
  const errorKey = ERROR_TEXT[status];
  const running = status === 'running';
  const active = running || status === 'suspended';

  const keyName = keyLabel(key, lang);
  const clefName = t[CLEF_LABEL_KEY[clef]];

  return (
    <div className="app" data-active={active}>
      <header className="topbar">
        <h1 className="brand">
          <img
            className="brand-logo"
            src="/icons/icon-192.png"
            alt={t.appTitle}
            width="32"
            height="32"
          />
          <span className="brand-word" aria-hidden="true">
            {t.appTitle}
          </span>
        </h1>
        <div className="chips">
          <button
            type="button"
            className="chip"
            data-testid="key-badge"
            aria-haspopup="dialog"
            aria-expanded={sheet === 'key'}
            aria-label={t.keyChip.replace('{value}', keyName)}
            onClick={() => setSheet('key')}
          >
            <span className="chip-text">{keyName}</span>
            <ChevronDownIcon />
          </button>
          <button
            type="button"
            className="chip chip-clef"
            data-testid="clef-chip"
            aria-haspopup="dialog"
            aria-expanded={sheet === 'clef'}
            aria-label={t.clefChip.replace('{value}', clefName)}
            onClick={() => setSheet('clef')}
          >
            <ClefGlyph clef={clef} />
            <span className="chip-text chip-clef-name">{clefName}</span>
          </button>
        </div>
        <a
          className="icon-btn icon-btn-quiet header-source"
          href={SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${t.sourceLink} ${t.opensNewTab}`}
          title={t.sourceLink}
          data-testid="header-source-link"
        >
          <GitHubIcon size={20} />
        </a>
        <button
          type="button"
          className="icon-btn"
          aria-label={t.settings}
          aria-haspopup="dialog"
          aria-expanded={sheet === 'settings'}
          onClick={() => setSheet('settings')}
        >
          <GearIcon />
        </button>
      </header>

      <main className="stage">
        <div className="readout">
          <div className="panel note-panel">
            <NoteDisplay
              store={store}
              naming={settings.naming}
              degreeStyle={settings.degreeStyle}
              hint={status === 'suspended' ? t.micPaused : running ? t.silence : t.idle}
            />
          </div>
          <div className="panel staff-panel">
            <Staff store={store} clef={clef} signature={signature} />
          </div>
        </div>

        <div className="panel gauge-panel">
          <CentsGauge store={store} zones={settings.zones} />
        </div>

        <div className="panel curve-panel">
          <PitchCurve store={store} keySpec={key} naming={settings.naming} zones={settings.zones} />
        </div>

        <LevelMeter levels={levels} hintHost={toastHost} />
        {debugStats && <DebugOverlay stats={debugStats} />}
      </main>

      <footer className="dock">
        <div className="toasts" ref={setToastHost}>
          {errorKey && (
            <div className="toast error" role="alert">
              <span>{t[errorKey]}</span>
              {status === 'suspended' && (
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void resume()}
                  data-testid="resume"
                >
                  {t.resume}
                </button>
              )}
            </div>
          )}
        </div>
        <div className="dock-bar">
          <DroneControls
            settings={settings}
            naming={settings.naming}
            onChange={(drone) => setSettings({ ...settings, drone })}
            onPlayingChange={onDronePlaying}
            store={store}
            visibility={visibility}
            toastHost={toastHost}
          />
          <button
            type="button"
            className={active ? 'start-btn stop' : 'start-btn'}
            onClick={() => void toggle()}
            disabled={status === 'starting'}
            data-testid="start-stop"
          >
            {active ? <StopIcon /> : <MicIcon />}
            <span className="start-label">
              {status === 'starting' ? t.starting : active ? t.stop : t.start}
            </span>
          </button>
          {/* Slot for the target note (degree + octave picker); see FEATURES.target. */}
          <button
            type="button"
            className="dock-btn target-slot"
            data-testid="target-slot"
            disabled={!FEATURES.target}
            title={t.targetSoon}
            aria-label={t.targetSoon}
          >
            <TargetIcon />
            <span className="dock-btn-text">
              <span className="dock-btn-title">{t.target}</span>
            </span>
          </button>
        </div>
      </footer>

      <Sheet
        open={sheet === 'settings'}
        onClose={closeSheet}
        title={t.settings}
        placement="side"
        testId="settings-sheet"
      >
        <SettingsPanel settings={settings} onChange={setSettings} mediaDevices={mediaDevices} />
      </Sheet>
      <Sheet open={sheet === 'key'} onClose={closeSheet} title={t.key} testId="key-sheet">
        <KeyPicker
          value={key}
          naming={settings.naming}
          onChange={(k) => {
            setSettings({ ...settings, key: k });
            closeSheet();
          }}
        />
      </Sheet>
      <Sheet open={sheet === 'clef'} onClose={closeSheet} title={t.clef} testId="clef-sheet">
        <ClefPicker
          value={clef}
          onChange={(c) => {
            setSettings({ ...settings, clef: c });
            closeSheet();
          }}
        />
      </Sheet>
    </div>
  );
}

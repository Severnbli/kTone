import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAnalyzer } from './engine';
import type { AnalyzerFactory } from './engine/types';
import { documentVisibility, type PageVisibility } from './audio/lifecycle';
import { MicError, startMic as realStartMic, type MicErrorCode, type StartMic } from './audio/mic';
import { PitchEngine, type EngineState } from './audio/pitchEngine';
import { PitchStore } from './audio/pitchStore';
import { browserWakeLock, ScreenWakeLock, type WakeLockApi } from './audio/wakeLock';
import { CentsGauge } from './components/CentsGauge';
import { DroneControls } from './components/DroneControls';
import { NoteDisplay } from './components/NoteDisplay';
import { PitchCurve } from './components/PitchCurve';
import { SettingsPanel } from './components/SettingsPanel';
import { Staff } from './components/Staff';
import { I18nProvider } from './i18n/I18nProvider';
import { useI18n } from './i18n/context';
import type { Strings } from './i18n/strings';
import { keyLabel } from './music/naming';
import { keySignature } from './music/theory';
import { loadSettings, saveSettings, type Settings } from './settings';

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
}

const defaultVisibility = documentVisibility();

export default function App(props: AppProps) {
  const [settings, setSettings] = useState<Settings>(() => props.initialSettings ?? loadSettings());
  useEffect(() => {
    saveSettings(settings);
    document.documentElement.lang = settings.lang;
  }, [settings]);
  return (
    <I18nProvider lang={settings.lang}>
      <Main {...props} settings={settings} setSettings={setSettings} />
    </I18nProvider>
  );
}

function Main({
  factory = createAnalyzer,
  startMic = realStartMic,
  visibility = defaultVisibility,
  wakeLock: wakeLockApi,
  settings,
  setSettings,
}: AppProps & { settings: Settings; setSettings: (s: Settings) => void }) {
  const { t, lang } = useI18n();
  const store = useMemo(() => new PitchStore(), []);
  const engineRef = useRef<PitchEngine | null>(null);
  engineRef.current ??= new PitchEngine(store, {
    factory,
    startMic,
    now: () => performance.now(),
    visibility,
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
  const onDronePlaying = useCallback((playing: boolean) => {
    wakeLockRef.current?.set('drone', playing);
  }, []);
  const [showSettings, setShowSettings] = useState(false);

  const { key, clef, a4Hz } = settings;
  const analyzerSettings = useMemo(() => ({ key, clef, a4Hz }), [key, clef, a4Hz]);
  const analyzerSettingsRef = useRef(analyzerSettings);
  useEffect(() => {
    analyzerSettingsRef.current = analyzerSettings;
    engineRef.current?.configure(analyzerSettings);
  }, [analyzerSettings]);

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

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <img className="brand-logo" src="/icons/icon-192.png" alt="" width="32" height="32" />
          <h1>{t.appTitle}</h1>
          <span className="key-badge" data-testid="key-badge">
            {keyLabel(key, lang)}
          </span>
        </div>
        <button
          type="button"
          className="btn icon"
          aria-expanded={showSettings}
          aria-controls="settings"
          onClick={() => setShowSettings((v) => !v)}
        >
          {showSettings ? t.close : t.settings}
        </button>
      </header>

      {showSettings && (
        <div id="settings" className="card">
          <SettingsPanel settings={settings} onChange={setSettings} />
        </div>
      )}

      <main className="app-main">
        <div className="card readout">
          <NoteDisplay
            store={store}
            naming={settings.naming}
            degreeStyle={settings.degreeStyle}
            hint={status === 'suspended' ? t.micPaused : running ? t.silence : t.idle}
          />
          <CentsGauge store={store} zones={settings.zones} />
        </div>

        <div className="card staff-card">
          <Staff store={store} clef={clef} signature={signature} />
        </div>

        <div className="card curve-card">
          <PitchCurve store={store} keySpec={key} naming={settings.naming} zones={settings.zones} />
        </div>

        <div className="controls">
          <button
            type="button"
            className={active ? 'btn primary stop' : 'btn primary'}
            onClick={() => void toggle()}
            disabled={status === 'starting'}
            data-testid="start-stop"
          >
            {status === 'starting' ? t.starting : active ? t.stop : t.start}
          </button>
          {status === 'suspended' && (
            <button
              type="button"
              className="btn"
              onClick={() => void resume()}
              data-testid="resume"
            >
              {t.resume}
            </button>
          )}
          {errorKey && (
            <p className="error" role="alert">
              {t[errorKey]}
            </p>
          )}
        </div>

        <div className="card">
          <DroneControls
            settings={settings}
            naming={settings.naming}
            onChange={(drone) => setSettings({ ...settings, drone })}
            onPlayingChange={onDronePlaying}
            visibility={visibility}
          />
        </div>
      </main>
    </div>
  );
}

# Decision log

## 2026-11-08 – MVP architecture

- **Decision:** Rust core (`core/`) with pitch detection (MPM) and music theory, exposed to the web via `wasm-bindgen` (`wasm/`). React + TypeScript + Vite PWA in `web/`. Docker Compose for the dev environment and the prototype.
- **Why:** one DSP/theory implementation reusable later in native apps; MPM is fast, accurate on voice and simple to implement without allocations.
- **Audio path:** `AudioWorklet` captures mic samples and posts them to the main thread; the main thread runs the WASM analyzer on 2048-sample frames with a 512-sample hop. Running WASM inside the worklet is a later optimization.
- **Alternatives:** YIN (similar quality, slightly more expensive), CREPE/SwiftF0 (more robust, much heavier – possible future option).

## 2026-11-08 – Pitch detector details

- **Decision:** MPM with NSDF computed via an in-house radix-2 FFT autocorrelation (frame 2048 padded to 4096), key-maxima threshold 0.9, parabolic interpolation. Tracker: RMS and clarity gates, 5-frame median in the semitone domain, octave guard (a jump of 1–2 octaves must persist for 4 frames), 30-cent hysteresis on the displayed note, history reset after 4 silent frames.
- **Why:** no runtime dependencies, no allocations per frame, sub-cent accuracy on clean signals, no octave errors in tests.
- **Trade-offs:** a real octave leap shows up after ~40 ms; low notes (~E2) in heavy noise can be off by up to ~7 cents.

## 2026-11-08 – Note spelling rule

- **Decision:** each key maps the 12 pitch classes to one spelling. Diatonic notes use the key spelling; minor keys spell raised 6th and 7th as raised degrees; other chromatic notes pick the spelling with the smaller accidental, ties go to raising in sharp keys and lowering in flat keys; C major / A minor use C♯ E♭ F♯ G♯ B♭.
- **Why:** deterministic, readable, avoids double accidentals for chromatic notes.

## 2026-11-08 – Engine loading

- **Decision:** the web app loads the WASM package through `import.meta.glob`, so builds and unit tests work without Rust; when the package is missing or fails to load, the TS mock engine is used. Analysis runs on the main thread; the AudioWorklet only captures audio.

## 2026-11-08 – Offline support and service worker updates

- **Decision:** a small in-repo Vite plugin (`web/sw/precache.ts`) writes `dist/sw.js` at build time: a precache manifest (every emitted file plus the public files, minus source maps and the worker itself) followed by the worker source `web/sw/sw.js`. The cache is named `ktone-<version>`, where the version is a SHA-256 over all precached paths and contents, so every build gets a fresh cache and a byte-different `sw.js`. Paths are relative to the worker scope, so a non-root Vite `base` works.
- **Fetch strategy:** precached files and all navigations (SPA fallback to `index.html`) are served cache-first from the active build's cache; other requests are not intercepted. A page therefore always runs one consistent build: bundles, `pitch-worklet.js` and the `.wasm` come from the same cache.
- **Update flow:** the new worker precaches the new build in the background and waits; it does not call `skipWaiting` on its own, so the open page (maybe mid-exercise) is never switched under the user. On the next launch `src/registerSW.ts` sees the waiting worker, sends `SKIP_WAITING` and reloads once on `controllerchange`, right at startup. On activate the worker deletes older `ktone-*` caches and claims the clients. The app also calls `registration.update()` when it returns to the foreground, for long-lived installed PWAs.
- **Server:** nginx serves `/assets/` (hashed) as `immutable` for a year and everything else (`index.html`, `sw.js`, the worklet, the manifest, icons) as `no-cache`. The precache also fetches with `cache: 'reload'` so a stale HTTP cache cannot leak into a new build's cache.
- **Alternatives:** Workbox / `vite-plugin-pwa` (heavy dependency and generated code for what is ~100 lines here); network-first navigations (fresh HTML online, but an old worker would then mix a new `index.html` with an old cached worklet); `skipWaiting` on install (immediate updates, but an open page could get a worklet from a different build); a "new version, reload?" prompt (needs UI in `App.tsx`, can be added later on top of the same waiting worker).
- **Caveats:** an update takes effect on the second launch after deploy (one to download it, one to apply it). With several tabs open, the tab that applies the update reloads, the others keep running and are claimed by the new worker.

## 2026-11-08 – Recorded voice test fixtures

- **Decision:** test the pitch tracker on five short excerpts (about 11 s, under 1 MB in total) from VocalSet 1.2 (Zenodo, DOI 10.5281/zenodo.1442513, CC BY 4.0): bass and baritone long tones, a soprano F5, a bass C4 with strong vibrato, a sung phrase with consonant onsets and an ascending scale. Clips live in `core/tests/fixtures/voice/` with `SOURCES.md` (attribution, cuts, ground truth); tests in `core/tests/pitch_voice.rs` read them with `hound` (dev-dependency only).
- **Why:** VocalSet is recorded by professional singers of known voice types, sung from a published score (so every note has a stated target), is mono 16-bit 44.1 kHz WAV, and its license allows redistribution with attribution. Single files can be extracted from the Zenodo archive with HTTP range requests, so the whole 2–6 GB archive is not needed.
- **Ground truth:** the note from the score, confirmed and refined (median pitch, note boundaries) by an independent offline YIN analysis with a spectral octave check, never by the detector under test.
- **Alternatives:** freesound.org CC0 vocals (no stated target notes, quality and licenses vary per upload), datasets under NC licenses such as Children's Song Dataset or GTSinger (not compatible with an open-source repository).

## 2026-11-08 – Judge accuracy by the vibrato center

- **Decision:** `PitchTracker` reports a vibrato center (`center_midi`, `center_cents` relative to `stable_midi`): a triangular-weighted moving average (weights 1, 2, .., 2, 1) of the accepted, octave-guarded but unmedianed estimates over `CENTER_WINDOW_SECS` = 300 ms. The window is configured in frames (`TrackerConfig::center_window`, default 28 for hop 512 at 48 kHz); `TrackerConfig::for_hop(sample_rate, hop)` sizes it for other rates. The center history restarts when `stable_midi` changes and with the rest of the smoothing state (pause of 4 frames, `reset`, A4 change). The WASM output appends `centerMidi` and `centerCents` (slots 12 and 13, 14 fields). The cents gauge needle, readout and zone follow `centerCents`; the pitch curve draws the raw pitch and colors segments by the center-based zone.
- **Why:** a ±40 cent vibrato at 5–6 Hz made the per-frame zone flick between green and red, although AGENTS.md says vibrato is judged by its center. A triangular window is two cascaded box filters: on synthetic ±40 cent vibrato the residual is about 5 cents at 4.5 Hz, 3 cents at 5 Hz and 1 cent or less from 5.5 Hz up, where a plain 250 ms average leaves up to about 9 cents. Restarting on a new stable note lets the needle settle on the new note about 60 ms after a leap.
- **Trade-offs:** the needle lags slow pitch drifts within a note by about half the window (~150 ms) – a calm needle was preferred over an instant one. Right after an onset or a note change the window holds only a few frames, so the center briefly follows the vibrato until it refills (~300 ms). A vibrato wide enough to cross the hysteresis band restarts the center on every crossing.
- **Alternatives:** plain moving average (cheaper, but leaves too much vibrato), low-pass IIR (no allocation either, but its long tail drags the previous note and needs explicit resets anyway), peak/valley tracking of the vibrato cycle (more precise for regular vibrato, fragile for irregular singing).

## 2026-11-08 – Mobile lifecycle: wake lock and audio interruptions

- **Decision:** the app reacts to phone-style interruptions with a few simple rules, implemented in `web/src/audio/lifecycle.ts`, `mic.ts`, `pitchEngine.ts`, `wakeLock.ts` and `DroneControls.tsx`:
  - **Screen Wake Lock** is held while the mic is running or the drone is playing, released otherwise, and re-requested when the page becomes visible again (the browser drops it when hidden). Missing API or refused requests are ignored.
  - **Mic track ended** (device unplugged, permission revoked, mic taken by another app): the engine stops and the UI says the mic was disconnected; "Start" starts a fresh session.
  - **Mic paused** (`AudioContext` `suspended` or Safari `interrupted`, or a muted track): the UI shows a "paused" state. While the page is visible the engine makes one automatic `resume()` attempt (immediately, or when the page becomes visible). If that fails, a "Resume" button appears; it is a user gesture, so it resumes the context, or restarts the mic if resuming the old session is not possible.
  - **Background:** after 60 s hidden the mic is stopped (freeing it for other apps) and the UI says so; coming back sooner changes nothing.
  - **Drone:** its own context follows the same rules: one automatic resume while visible; if that fails, the drone turns off with a short message, and a tap restarts it; 60 s hidden stops it.
  - `resume()` attempts are capped at 1 s, because iOS can leave the promise pending outside a user gesture.
- **Why:** before this, the app silently stopped producing frames while the UI still said it was listening. Automatic recovery covers the common short interruptions; anything that needs a gesture gets an explicit button; long background stays do not hold the mic.
- **Testability:** page visibility, the wake lock API, the mic starter and the drone's `AudioContext` are injected, and the track/context event mapping is a pure function (`watchMicState`), so all rules are covered by Vitest with fakes; e2e checks a real suspended context and an ended track in Chromium.
- **Alternatives:** stopping the mic as soon as the page is hidden (loses the session on a quick app switch); never stopping in the background (keeps the mic indicator on and blocks other apps); auto-retrying resume in a loop (useless on iOS without a gesture, wastes battery).

## 2026-11-08 – Input level meter, level hints and microphone choice

- **Decision:** the web side measures the raw input on every analysis frame (2048 samples, every 512), whether or not a pitch was found, in `web/src/audio/level.ts`: RMS in dBFS (digital silence is −Infinity) and the linear peak, allocation-free. `PitchEngine` feeds a `LevelStore` that the meter reads imperatively, like the cents gauge; React re-renders only when the hint changes.
- **Meter:** RMS on a −70..0 dBFS bar under the cents gauge, with a marker at the analyzer gate. The gate is the core's `rms_threshold` 0.005 (about −46 dBFS), kept as one constant (`ANALYZER_GATE_RMS`) that the meter and hints take as a parameter, so a future noise calibration can pass a measured value instead.
- **Hints** (time hysteresis, so they do not flicker):
  - _Too quiet_: no pitch while the RMS is between the noise floor (−60 dBFS) and the gate, uninterrupted for 1 s.
  - _Too loud_: a sample at or above 0.98 (about −0.2 dBFS) keeps a "clipping" condition true for 250 ms; the hint shows once that has held for 300 ms.
  - A shown hint disappears after its condition has been gone for 1 s, and at once when listening stops or is suspended.
- **Microphone choice:** a picker in the settings, filled from `enumerateDevices()` (audio inputs only, Chrome's `default` alias dropped, unnamed inputs shown as «Микрофон N», a note while the browser hides the list before permission), refreshed on `devicechange`. The choice is saved as `micDeviceId` (`''` = system default; any non-string or a string over 256 chars falls back to `''`). `startMic` asks for `deviceId: { exact }` with all voice processing still off; if that device is gone (`OverconstrainedError` or `NotFoundError`) it retries once with the system default. The saved id is kept even when the device is missing (a USB mic that comes back is used again); the picker then shows the default with a note. Changing the device while listening restarts the mic session without going idle.
- **Why:** before this, a too-quiet singer saw only "silence" with no clue why; a level meter with the gate marker shows how far off the input is. Exact `deviceId` makes the choice binding instead of a hint the browser may ignore; the fallback keeps a stale id from breaking Start.
- **Alternatives:** measuring in the worklet (more plumbing for no gain at a 512-sample hop); reusing `PitchFrame.rms` (only reported for voiced frames); dropping the stale id from settings (loses the choice when a device is briefly unplugged); `deviceId` as an ideal constraint (silently opens another device).

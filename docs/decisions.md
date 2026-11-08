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

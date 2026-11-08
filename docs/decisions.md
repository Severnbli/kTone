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

## 2026-11-08 – Judge accuracy by the vibrato center

- **Decision:** `PitchTracker` reports a vibrato center (`center_midi`, `center_cents` relative to `stable_midi`): a triangular-weighted moving average (weights 1, 2, .., 2, 1) of the accepted, octave-guarded but unmedianed estimates over `CENTER_WINDOW_SECS` = 300 ms. The window is configured in frames (`TrackerConfig::center_window`, default 28 for hop 512 at 48 kHz); `TrackerConfig::for_hop(sample_rate, hop)` sizes it for other rates. The center history restarts when `stable_midi` changes and with the rest of the smoothing state (pause of 4 frames, `reset`, A4 change). The WASM output appends `centerMidi` and `centerCents` (slots 12 and 13, 14 fields). The cents gauge needle, readout and zone follow `centerCents`; the pitch curve draws the raw pitch and colors segments by the center-based zone.
- **Why:** a ±40 cent vibrato at 5–6 Hz made the per-frame zone flick between green and red, although AGENTS.md says vibrato is judged by its center. A triangular window is two cascaded box filters: on synthetic ±40 cent vibrato the residual is about 5 cents at 4.5 Hz, 3 cents at 5 Hz and 1 cent or less from 5.5 Hz up, where a plain 250 ms average leaves up to about 9 cents. Restarting on a new stable note lets the needle settle on the new note about 60 ms after a leap.
- **Trade-offs:** the needle lags slow pitch drifts within a note by about half the window (~150 ms) – a calm needle was preferred over an instant one. Right after an onset or a note change the window holds only a few frames, so the center briefly follows the vibrato until it refills (~300 ms). A vibrato wide enough to cross the hysteresis band restarts the center on every crossing.
- **Alternatives:** plain moving average (cheaper, but leaves too much vibrato), low-pass IIR (no allocation either, but its long tail drags the previous note and needs explicit resets anyway), peak/valley tracking of the vibrato cycle (more precise for regular vibrato, fragile for irregular singing).

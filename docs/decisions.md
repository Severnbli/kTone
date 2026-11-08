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

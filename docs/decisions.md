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

## 2026-11-08 – Recorded voice test fixtures

- **Decision:** test the pitch tracker on five short excerpts (about 11 s, under 1 MB in total) from VocalSet 1.2 (Zenodo, DOI 10.5281/zenodo.1442513, CC BY 4.0): bass and baritone long tones, a soprano F5, a bass C4 with strong vibrato, a sung phrase with consonant onsets and an ascending scale. Clips live in `core/tests/fixtures/voice/` with `SOURCES.md` (attribution, cuts, ground truth); tests in `core/tests/pitch_voice.rs` read them with `hound` (dev-dependency only).
- **Why:** VocalSet is recorded by professional singers of known voice types, sung from a published score (so every note has a stated target), is mono 16-bit 44.1 kHz WAV, and its license allows redistribution with attribution. Single files can be extracted from the Zenodo archive with HTTP range requests, so the whole 2–6 GB archive is not needed.
- **Ground truth:** the note from the score, confirmed and refined (median pitch, note boundaries) by an independent offline YIN analysis with a spectral octave check, never by the detector under test.
- **Alternatives:** freesound.org CC0 vocals (no stated target notes, quality and licenses vary per upload), datasets under NC licenses such as Children's Song Dataset or GTSinger (not compatible with an open-source repository).

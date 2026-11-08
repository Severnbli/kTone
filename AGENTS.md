# AGENTS.md

Shared instructions for every AI coding agent working in this repository (Claude Code, Codex and others) and for the humans working with them. `CLAUDE.md` only imports this file, so edit rules here.

## Project

kTone is a smart pitch detector for people learning to sing. It listens to the microphone and shows in real time which note is being sung, how far off it is in cents, and whether the singer hit the target note.

Key ideas that set it apart from a plain tuner:

- **Key signature drives note spelling.** The same pitch is spelled as F♯ in D major and as G♭ in D♭ major. Notes are also shown as scale degrees, and out-of-key notes are highlighted.
- **Clef drives the staff.** Treble, bass, alto, tenor and treble-8vb (for male voices). The current note is drawn on the staff.
- **Analysis over time:** pitch curve, attack, stability, vibrato (judged by its center, not counted as a miss), range and per-note statistics.

### MVP scope

1. Microphone → pitch detection → note + cents deviation + hit indicator.
2. Key and clef selection with correct ♯/♭ spelling; note on a staff.
3. Pitch curve for the last 5–10 seconds.
4. Drone on the tonic.

Later: exercises (echo, scales, intervals, sight-singing, MIDI/MusicXML import), recording with pitch overlay, progress history, native apps.

## Platforms and stack

- **First target:** web app (PWA) that works on phones, tablets and desktops.
- **Audio core:** Rust, compiled to WASM for the web. Keep it platform-agnostic so it can later be reused in native apps (e.g. Flutter via flutter_rust_bridge).
- **UI:** TypeScript + React, audio via Web Audio API and `AudioWorklet`.

### Layout

```
core/     Rust crate: pitch detection (MPM), smoothing, music theory
wasm/     wasm-bindgen bindings for the core (numeric, allocation-light API)
web/      React + TypeScript PWA; src/engine/ wraps the WASM build, mock.ts is the TS fallback
scripts/  build-wasm.sh, make-icons.py
assets/   brand sources (logo, banner)
deploy/   nginx config for the production image
docs/     decision log
```

### Commands

Everything runs in Docker; nothing but Docker is needed on the host.

```sh
docker compose up web                                  # dev server, http://localhost:5173
docker compose run --rm dev cargo fmt --all            # format Rust
docker compose run --rm dev cargo clippy --workspace --all-targets -- -D warnings
docker compose run --rm dev cargo test --workspace
docker compose run --rm dev pnpm -C web wasm           # build core to web/src/wasm-pkg
docker compose run --rm dev pnpm -C web lint           # ESLint + Prettier check
docker compose run --rm dev pnpm -C web format
docker compose run --rm dev pnpm -C web test           # Vitest (unit + component)
docker compose run --rm dev pnpm -C web build
docker compose run --rm e2e                            # Playwright, fake microphone
docker compose --profile prod up app                   # production image, http://localhost:8080
python3 scripts/make-icons.py                          # regenerate icons from assets/brand
```

Before every commit run the checks for the parts you touched: Rust fmt + clippy + tests, and web lint + test + build. Run e2e when UI or engine behavior changes. CI runs all of them on every push and PR to `main` and `dev`.

### CI/CD

`.github/workflows/ci.yml`: Rust checks, web checks (incl. e2e with the real WASM engine), then on push only, the production image is pushed to Docker Hub as `severnbli/ktone` – `dev` from the dev branch, `latest` from main, plus `<branch>-<sha>` tags. Secrets: `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`.

## Audio and DSP requirements

- Latency from voice to screen: 50 ms or less, target 30 ms.
- Pitch algorithm: start with MPM (McLeod) or YIN; a neural detector (CREPE, SwiftF0) may be added later as an option.
- Always smooth the output: median filter, hysteresis between neighboring notes, confidence threshold. The displayed note must not flicker.
- Guard explicitly against octave errors.
- Never do allocation, locking or other blocking work on the audio thread.
- Supported voice range: roughly E2 (bass) to C6 (soprano), with some margin.

## Music conventions

- Default note names: solfège (до-ре-ми) with Russian octave naming (ля первой октавы). Settings allow switching to letter names (C-D-E) with scientific pitch notation (A4).
- Internally, always use MIDI note numbers / scientific pitch notation. Naming is a presentation concern.
- Default reference: A4 = 440 Hz, configurable (e.g. 442, 432).
- Default hit zones: green within ±10 cents, yellow within ±25 cents, red beyond. Configurable.

## Code style

- All code, comments, commit messages, PR descriptions and docs are in **English**. UI strings are localized (Russian first).
- Formatting and linting: `rustfmt` + `clippy` for Rust, Prettier + ESLint for TypeScript. Code must pass them with no warnings.
- Writing style: never use the em dash (—). Use the en dash (–) instead, everywhere: code comments, docs, commit messages, PR descriptions.

## Testing

Everything is covered by tests:

- **core/**: unit tests for pitch detection on synthetic signals (sine, harmonics, noise, vibrato) and on recorded voice samples; tests for note spelling across all keys and clefs.
- **web/**: component tests for UI.
- **e2e:** end-to-end tests for the main flows (with a fake audio input).

New features and bug fixes come with tests. A bug fix starts with a failing test that reproduces the bug.

## Git workflow

- `main` – stable releases only. Updated only by PR from `dev`.
- `dev` – integration branch. Updated only by PR from feature branches.
- Feature branches: `feat/<short-name>`, `fix/<short-name>`, `chore/<short-name>`, branched from `dev`.
- Every PR targets `dev` (except release PRs `dev` → `main`). Approval is not required to merge, but asking the other human on the team for a review is encouraged.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(core): add MPM pitch detector`.
- Commit early and often: small, focused commits, each one building and passing tests.

## What agents may do without asking

- Install dependencies (npm packages, Rust crates).
- Create commits in a feature branch.
- Push feature branches and open PRs into `dev`.
- Change configs and CI (tsconfig, Cargo.toml, linters, GitHub Actions).

Agents must never:

- Commit or push directly to `main` or `dev`, merge PRs, or force-push shared branches.
- Rewrite history that is already pushed.
- Commit secrets, large binaries or generated build output.

## Decision log

Record significant decisions (algorithm choice, library choice, architecture changes) in `docs/decisions.md`: date, decision, reasoning, alternatives considered.

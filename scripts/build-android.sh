#!/bin/sh
# Build the shared Rust detector and UI, then package them in an installable APK.
set -eu
cd "$(dirname "$0")/.."

docker compose run --build --rm -e VITE_GIT_SHA="$(git rev-parse --short HEAD)" dev sh -ec '
  pnpm -C web install --frozen-lockfile
  pnpm -C web wasm
  pnpm -C web build
'
exec ./android/gradlew -p android :app:assembleDebug

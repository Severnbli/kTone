#!/bin/sh
# Builds the Rust core to WebAssembly and generates JS bindings into web/src/wasm-pkg.
set -eu
cd "$(dirname "$0")/.."
cargo build -p ktone-wasm --target wasm32-unknown-unknown --release
wasm-bindgen --target web --out-dir web/src/wasm-pkg \
  target/wasm32-unknown-unknown/release/ktone_wasm.wasm

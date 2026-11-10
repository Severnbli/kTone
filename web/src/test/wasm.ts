// Loads the real Rust engine for tests (`wasm.test.ts`, `parity.test.ts`).
// Tests using it skip when the WASM package has not been built (`pnpm wasm`).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { wrapWasm, type WasmModule } from '../engine/index';
import type { Analyzer, AnalyzerOptions } from '../engine/types';

// Vitest runs from web/; jsdom gives modules http URLs, so resolve from cwd.
const pkgDir = `${resolve('src/wasm-pkg')}/`;

export const hasWasm = existsSync(`${pkgDir}ktone_wasm_bg.wasm`);

export async function loadWasmAnalyzer(
  sampleRate = 48_000,
  options?: AnalyzerOptions,
): Promise<Analyzer> {
  const mod = (await import(/* @vite-ignore */ `${pkgDir}ktone_wasm.js`)) as WasmModule & {
    initSync: (opts: { module: BufferSource }) => unknown;
  };
  mod.initSync({ module: readFileSync(`${pkgDir}ktone_wasm_bg.wasm`) });
  return wrapWasm(mod, sampleRate, options);
}

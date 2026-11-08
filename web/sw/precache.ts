// Build-time precache manifest for the service worker.
//
// The Vite plugin below collects every file of the production build (hashed
// bundles, the .wasm, index.html and the public files such as the worklet and
// icons), derives a build version from their contents and writes `sw.js` into
// the output directory: the precache manifest followed by `sw/sw.js`. A new
// build therefore always changes the bytes of `sw.js`, which is what makes the
// browser install the new worker.

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const SW_FILE = 'sw.js';
const SW_TEMPLATE = new URL('./sw.js', import.meta.url);

export interface PrecacheManifest {
  /** Content hash of the whole build; names the cache. */
  version: string;
  /** Paths relative to the service worker scope (the Vite `base`), no leading slash. */
  files: string[];
}

export interface BuildFile {
  /** Path relative to the output directory, `/`-separated. */
  path: string;
  content: string | Uint8Array;
}

/** Files that must not be precached: the worker itself, source maps, OS junk. */
export function shouldPrecache(path: string): boolean {
  if (path === SW_FILE) return false;
  if (path.endsWith('.map')) return false;
  const name = path.slice(path.lastIndexOf('/') + 1);
  return !name.startsWith('.');
}

/** Builds the manifest: a sorted file list plus a version hashed from all contents. */
export function createManifest(files: readonly BuildFile[]): PrecacheManifest {
  const kept = files
    .filter((f) => shouldPrecache(f.path))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const hash = createHash('sha256');
  for (const f of kept) {
    hash.update(f.path);
    hash.update('\0');
    hash.update(createHash('sha256').update(f.content).digest());
  }
  return { version: hash.digest('hex').slice(0, 12), files: kept.map((f) => f.path) };
}

/** Prepends the manifest to the worker source. */
export function renderServiceWorker(template: string, manifest: PrecacheManifest): string {
  return `self.__KTONE_PRECACHE__ = ${JSON.stringify(manifest)};\n${template}`;
}

function listFiles(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  return entries.flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

/** Vite plugin: writes `sw.js` with the precache manifest of this build. */
export function precacheServiceWorker(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'ktone:precache-sw',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    writeBundle(_options, bundle) {
      const outDir = join(config.root, config.build.outDir);
      const files: BuildFile[] = Object.values(bundle).map((chunk) => ({
        path: chunk.fileName,
        content: chunk.type === 'chunk' ? chunk.code : chunk.source,
      }));
      const emitted = new Set(files.map((f) => f.path));
      if (config.publicDir) {
        for (const full of listFiles(config.publicDir)) {
          const path = relative(config.publicDir, full).split(sep).join('/');
          if (!emitted.has(path)) files.push({ path, content: readFileSync(full) });
        }
      }
      const manifest = createManifest(files);
      const source = renderServiceWorker(readFileSync(SW_TEMPLATE, 'utf8'), manifest);
      writeFileSync(join(outDir, SW_FILE), source);
      config.logger.info(
        `ktone: ${SW_FILE} precaches ${manifest.files.length} files, version ${manifest.version}`,
      );
    },
  };
}

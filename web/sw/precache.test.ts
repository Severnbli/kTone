import { describe, expect, it } from 'vitest';
import { createManifest, renderServiceWorker, shouldPrecache } from './precache';

const build = [
  { path: 'index.html', content: '<html></html>' },
  { path: 'assets/index-abc123.js', content: 'console.log(1)' },
  { path: 'assets/index-abc123.js.map', content: '{}' },
  { path: 'assets/ktone_wasm_bg-def456.wasm', content: new Uint8Array([0, 97, 115, 109]) },
  { path: 'pitch-worklet.js', content: 'registerProcessor()' },
  { path: 'icons/icon-192.png', content: new Uint8Array([1, 2, 3]) },
  { path: 'sw.js', content: 'old worker' },
  { path: 'icons/.DS_Store', content: 'junk' },
];

describe('shouldPrecache', () => {
  it('skips the worker itself, source maps and dotfiles', () => {
    expect(shouldPrecache('sw.js')).toBe(false);
    expect(shouldPrecache('assets/a.js.map')).toBe(false);
    expect(shouldPrecache('icons/.DS_Store')).toBe(false);
    expect(shouldPrecache('assets/a.wasm')).toBe(true);
    expect(shouldPrecache('pitch-worklet.js')).toBe(true);
  });
});

describe('createManifest', () => {
  it('lists every runtime file, sorted and relative to the scope', () => {
    expect(createManifest(build).files).toEqual([
      'assets/index-abc123.js',
      'assets/ktone_wasm_bg-def456.wasm',
      'icons/icon-192.png',
      'index.html',
      'pitch-worklet.js',
    ]);
  });

  it('has a stable version that does not depend on file order', () => {
    const a = createManifest(build);
    const b = createManifest([...build].reverse());
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(b.version).toBe(a.version);
  });

  it('changes the version when any precached file changes', () => {
    const base = createManifest(build).version;
    const worklet = build.map((f) =>
      f.path === 'pitch-worklet.js' ? { ...f, content: 'registerProcessor(2)' } : f,
    );
    expect(createManifest(worklet).version).not.toBe(base);
    const renamed = build.map((f) =>
      f.path === 'icons/icon-192.png' ? { ...f, path: 'icons/icon-193.png' } : f,
    );
    expect(createManifest(renamed).version).not.toBe(base);
  });

  it('ignores files that are not precached', () => {
    const base = createManifest(build).version;
    const map = build.map((f) => (f.path.endsWith('.map') ? { ...f, content: '{"v":2}' } : f));
    expect(createManifest(map).version).toBe(base);
  });
});

describe('renderServiceWorker', () => {
  it('prepends the manifest as a global the worker reads', () => {
    const manifest = { version: 'abc', files: ['index.html'] };
    const source = renderServiceWorker('const P = self.__KTONE_PRECACHE__;', manifest);
    const self: { __KTONE_PRECACHE__?: unknown } = {};
    new Function('self', source)(self);
    expect(self.__KTONE_PRECACHE__).toEqual(manifest);
  });
});

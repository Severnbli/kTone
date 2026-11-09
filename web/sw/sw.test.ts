// Runs the real worker source (sw/sw.js) against an in-memory Cache Storage
// and a fake network.
/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { renderServiceWorker, type PrecacheManifest } from './precache';
import TEMPLATE from './sw.js?raw';

const SCOPE = 'https://example.test/app/';

class MemoryCache {
  readonly entries = new Map<string, Response>();
  async addAll(requests: Request[]) {
    for (const req of requests) {
      const res = await network(req);
      if (!res.ok) throw new TypeError(`bad status for ${req.url}`);
      this.entries.set(req.url, res);
    }
  }
  async match(req: Request | string) {
    const url = typeof req === 'string' ? req : req.url;
    return this.entries.get(url)?.clone();
  }
}

let network: (req: Request) => Promise<Response>;

function createWorker(manifest: PrecacheManifest, existing: Record<string, MemoryCache> = {}) {
  const stores = new Map(Object.entries(existing));
  const caches = {
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new MemoryCache());
      return stores.get(name)!;
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
  };
  const listeners = new Map<string, (event: unknown) => void>();
  const self = {
    registration: { scope: SCOPE },
    location: new URL(`${SCOPE}sw.js`),
    clients: { claim: vi.fn(async () => undefined) },
    skipWaiting: vi.fn(async () => undefined),
    addEventListener: (type: string, fn: (event: unknown) => void) => listeners.set(type, fn),
  };
  const fetchFn = (input: Request | string) =>
    network(typeof input === 'string' ? new Request(input) : input);
  new Function('self', 'caches', 'fetch', renderServiceWorker(TEMPLATE, manifest))(
    self,
    caches,
    fetchFn,
  );

  const lifecycle = async (type: 'install' | 'activate') => {
    let done: Promise<unknown> = Promise.resolve();
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
  };
  const fetch = async (url: string, init: { mode?: RequestMode; method?: string } = {}) => {
    const request = { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' };
    let response: Promise<Response> | undefined;
    listeners.get('fetch')!({ request, respondWith: (r: Promise<Response>) => (response = r) });
    return response ? await response : undefined;
  };
  const message = (data: unknown) => listeners.get('message')!({ data });
  return { self, stores, lifecycle, fetch, message };
}

const manifest = (version: string): PrecacheManifest => ({
  version,
  files: ['index.html', `assets/index-${version}.js`, 'assets/engine.wasm', 'pitch-worklet.js'],
});

const online = () => {
  const requested: Request[] = [];
  network = async (req) => {
    requested.push(req);
    return new Response(`net:${new URL(req.url).pathname}`);
  };
  return requested;
};
const offline = () => {
  network = async () => {
    throw new TypeError('offline');
  };
};

describe('service worker', () => {
  it('precaches every manifest file relative to the scope, bypassing the HTTP cache', async () => {
    const requested = online();
    const sw = createWorker(manifest('v1'));
    await sw.lifecycle('install');

    expect(requested.map((r) => r.url).sort()).toEqual([
      `${SCOPE}assets/engine.wasm`,
      `${SCOPE}assets/index-v1.js`,
      `${SCOPE}index.html`,
      `${SCOPE}pitch-worklet.js`,
    ]);
    expect(requested.every((r) => r.cache === 'reload')).toBe(true);
    expect([...sw.stores.keys()]).toEqual(['ktone-v1']);
  });

  it('serves the app from the cache when offline', async () => {
    online();
    const sw = createWorker(manifest('v1'));
    await sw.lifecycle('install');
    offline();

    const page = await sw.fetch(`${SCOPE}`, { mode: 'navigate' });
    expect(await page?.text()).toBe('net:/app/index.html');
    const deep = await sw.fetch(`${SCOPE}some/route?x=1`, { mode: 'navigate' });
    expect(await deep?.text()).toBe('net:/app/index.html');
    const wasm = await sw.fetch(`${SCOPE}assets/engine.wasm`);
    expect(await wasm?.text()).toBe('net:/app/assets/engine.wasm');
    const worklet = await sw.fetch(`${SCOPE}pitch-worklet.js?v=2`);
    expect(await worklet?.text()).toBe('net:/app/pitch-worklet.js');
  });

  it('serves the worklet from its own build even when the network has a newer one', async () => {
    online();
    const sw = createWorker(manifest('v1'));
    await sw.lifecycle('install');
    network = async () => new Response('newer build');
    expect(await (await sw.fetch(`${SCOPE}pitch-worklet.js`))?.text()).toBe(
      'net:/app/pitch-worklet.js',
    );
  });

  it('leaves other requests to the browser', async () => {
    online();
    const sw = createWorker(manifest('v1'));
    await sw.lifecycle('install');
    expect(await sw.fetch(`${SCOPE}api/unknown.json`)).toBeUndefined();
    expect(await sw.fetch('https://cdn.example.org/x.js')).toBeUndefined();
    expect(await sw.fetch(`${SCOPE}index.html`, { method: 'POST' })).toBeUndefined();
  });

  it('deletes caches of older builds on activate and claims the pages', async () => {
    online();
    const old = new MemoryCache();
    const foreign = new MemoryCache();
    const sw = createWorker(manifest('v2'), { 'ktone-v1': old, 'ktone-v2': old, other: foreign });
    await sw.lifecycle('activate');
    expect([...sw.stores.keys()].sort()).toEqual(['ktone-v2', 'other']);
    expect(sw.self.clients.claim).toHaveBeenCalled();
  });

  it('waits until the page asks it to take over', async () => {
    online();
    const sw = createWorker(manifest('v2'));
    await sw.lifecycle('install');
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.message({ type: 'other' });
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();
    sw.message({ type: 'SKIP_WAITING' });
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it('fails the install when a file is missing, keeping the old worker', async () => {
    network = async (req) =>
      req.url.endsWith('.wasm') ? new Response('', { status: 404 }) : new Response('ok');
    const sw = createWorker(manifest('v1'));
    await expect(sw.lifecycle('install')).rejects.toThrow();
  });
});

// kTone service worker. The build (sw/precache.ts) prepends
// `self.__KTONE_PRECACHE__ = { version, files }` and writes the result to
// `dist/sw.js`, so every build has its own worker and its own cache.
//
// Strategy:
// - install: precache every file of the build into `ktone-<version>`, so the
//   app works offline right after the first visit;
// - fetch: precached files and navigations are served cache-first from this
//   build's cache, so a page always runs one consistent build (bundles,
//   worklet and .wasm); everything else goes to the network untouched;
// - update: a new worker waits until the page asks it to take over
//   (`SKIP_WAITING`, see src/registerSW.ts); on activate it deletes the caches
//   of older builds and claims the open pages.
'use strict';

const PRECACHE = self.__KTONE_PRECACHE__;
const CACHE_PREFIX = 'ktone-';
const CACHE = CACHE_PREFIX + PRECACHE.version;
const INDEX = 'index.html';

/** Resolves a manifest path against the worker scope (honors Vite's `base`). */
const toUrl = (path) => new URL(path, self.registration.scope).href;

const precached = new Set(PRECACHE.files.map(toUrl));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // `reload` skips the HTTP cache so a stale non-hashed file (index.html,
      // the worklet) cannot end up in the cache of a newer build.
      cache.addAll(PRECACHE.files.map((path) => new Request(toUrl(path), { cache: 'reload' }))),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

function fromCache(request, fallbackPath) {
  return caches.open(CACHE).then((cache) =>
    cache
      .match(request)
      .then((hit) => hit || (fallbackPath ? cache.match(toUrl(fallbackPath)) : undefined))
      .then((hit) => hit || fetch(request)),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // Single-page app: any in-scope navigation gets this build's index.html.
    event.respondWith(fromCache(request, INDEX));
    return;
  }
  url.search = '';
  url.hash = '';
  if (precached.has(url.href)) event.respondWith(fromCache(url.href));
});

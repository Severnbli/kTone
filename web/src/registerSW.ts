// Registers the service worker (`sw/sw.js`, built into `dist/sw.js`) and
// applies updates predictably.
//
// A new build's worker installs in the background and then waits, so the open
// page keeps running the build it started with. On the next launch, if a
// worker is waiting, the page tells it to take over and reloads once, right at
// startup and before the user can start singing. See docs/decisions.md.

export const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

export interface RegisterOptions {
  container?: ServiceWorkerContainer;
  base?: string;
  reload?: () => void;
  doc?: Document;
}

export async function registerServiceWorker({
  container = navigator.serviceWorker,
  base = import.meta.env.BASE_URL,
  reload = () => window.location.reload(),
  doc = document,
}: RegisterOptions = {}): Promise<ServiceWorkerRegistration> {
  const controlled = container.controller !== null;
  const registration = await container.register(`${base}sw.js`, { scope: base });

  // Without a controller (first visit) there is nothing to replace.
  if (controlled && registration.waiting) {
    let reloading = false;
    container.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      reload();
    });
    registration.waiting.postMessage(SKIP_WAITING);
  }

  // Installed PWAs can stay open for days: look for a new build whenever the
  // app comes back to the foreground. It is applied on the next launch.
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'visible') registration.update().catch(() => undefined);
  });

  return registration;
}

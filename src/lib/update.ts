/** Keeps the installed app current. Without this, a home-screen app can keep running an old copy for days. */
let reg: ServiceWorkerRegistration | undefined;

export const BUILD = typeof __RISE_BUILD__ !== 'undefined' ? __RISE_BUILD__ : 'dev';

export function startUpdates() {
  import('virtual:pwa-register')
    .then(({ registerSW }) =>
      registerSW({
        immediate: true,
        onRegisteredSW(_url, r) {
          reg = r;
          // Check for a new version whenever Rise comes back to the screen.
          document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && r?.update().catch(() => {}));
        }
      })
    )
    .catch(() => {});
}

/** Fetches the newest version and restarts into it. */
export async function updateNow(): Promise<void> {
  try {
    await reg?.update();
    const waiting = reg?.waiting;
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
  } catch {
    /* offline */
  }
  // Clear the cached app shell so the restart loads fresh files.
  try {
    if (navigator.onLine) for (const name of await caches.keys()) if (/workbox-precache/.test(name)) await caches.delete(name);
  } catch {
    /* no caches */
  }
  location.reload();
}

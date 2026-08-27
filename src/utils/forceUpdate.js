/**
 * Build identity + a hard "get me the newest build" escape hatch.
 *
 * The app already polls /version.json and shows an update banner, but nothing
 * ever told the user WHICH build they were looking at — so "I deployed that"
 * and "I don't see it" had no way to be settled except by guessing. BUILD_LABEL
 * is rendered in the Settings menu, and forceAppUpdate() is the button next to
 * it.
 */

// Injected by Vite's define at build time (buildVersionPlugin in vite.config.js).
export const BUILD_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

/** The running build as a local date + time, e.g. "Aug 25, 9:15 PM". */
export const BUILD_LABEL = (() => {
  const n = Number(BUILD_VERSION);
  if (!n) return 'dev';
  try {
    return new Date(n).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return String(BUILD_VERSION);
  }
})();

/** Is the deployed build newer than the one this tab is running? */
export async function isUpdateAvailable() {
  if (!BUILD_VERSION) return false;
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const data = await res.json();
    return !!data.version && data.version !== BUILD_VERSION;
  } catch {
    return false; // offline — nothing to switch to anyway
  }
}

/**
 * Unregister every service worker, wipe every Cache Storage entry, then reload.
 *
 * The nuclear option on purpose: an older SW built with skipWaiting can keep
 * handing out stale HTML — which then references hashed assets that no longer
 * exist, and vercel.json's SPA rewrite answers those with index.html at HTTP
 * 200 instead of a 404. Clearing the lot is the only reliably terminal fix.
 */
export async function forceAppUpdate() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister().catch(() => {})));
    }
  } catch { /* nothing registered, or blocked — the cache purge still helps */ }
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
    }
  } catch { /* storage blocked (private mode) — reload anyway */ }
  window.location.reload();
}

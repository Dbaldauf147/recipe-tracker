import { useState, useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import styles from './UpdatePrompt.module.css';

// Query-param override for design/QA — lets you preview the pill on any page
// without waiting for a real service-worker update. Append ?updatePill=1.
const forcePill =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('updatePill') === '1';

// Injected by Vite's define at build time (see buildVersionPlugin in
// vite.config.js). Used to compare against /version.json so we can show the
// update pill without depending on the service-worker update lifecycle.
const BUILD_VERSION =
  typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '';

export function UpdatePrompt() {
  const [dismissed, setDismissed] = useState(false);
  const [versionMismatch, setVersionMismatch] = useState(false);
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      // Check for updates every 60 seconds
      if (r) {
        setInterval(() => r.update(), 60 * 1000);
      }
    },
  });

  // Fallback: poll /version.json every 60s and show the pill if the deployed
  // build differs from what this session started with.
  useEffect(() => {
    if (!BUILD_VERSION) return;
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data.version && data.version !== BUILD_VERSION) {
          setVersionMismatch(true);
        }
      } catch { /* offline / 404 — ignore */ }
    }
    check();
    const id = setInterval(check, 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const show = (needRefresh || versionMismatch || forcePill) && !dismissed;
  if (!show) return null;

  async function handleUpdate() {
    // Best-effort: tell the waiting SW to skip waiting so it takes over.
    try { await updateServiceWorker(true); } catch { /* ignore */ }
    // Nuclear option for stuck SWs: unregister every registration and wipe
    // every Cache Storage entry before reloading. Without this, an older SW
    // built with skipWaiting:true can keep serving stale HTML/JS even after a
    // new deploy.
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister().catch(() => {})));
      }
    } catch { /* ignore */ }
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
      }
    } catch { /* ignore */ }
    // Hard reload. Some browsers honor `true` to bypass the HTTP cache; others
    // ignore it, but the SW/cache purge above already did the real work.
    setTimeout(() => window.location.reload(), 200);
  }

  return (
    <div className={styles.banner}>
      <span>A new version is available</span>
      <button className={styles.updateBtn} onClick={handleUpdate}>
        Update
      </button>
      <button className={styles.dismissBtn} onClick={() => setDismissed(true)}>
        &times;
      </button>
    </div>
  );
}

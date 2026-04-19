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
    try { await updateServiceWorker(true); } catch { /* ignore */ }
    // Fallback: force reload (bypasses HTTP cache) so the new bundle loads
    // even if the service worker didn't swap.
    setTimeout(() => window.location.reload(), 400);
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

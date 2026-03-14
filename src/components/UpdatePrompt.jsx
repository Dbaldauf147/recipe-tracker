import { useRegisterSW } from 'virtual:pwa-register/react';
import styles from './UpdatePrompt.module.css';

export function UpdatePrompt() {
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

  if (!needRefresh) return null;

  async function handleUpdate() {
    // Tell the waiting SW to activate
    updateServiceWorker(true);
    // Immediately clear all caches and hard reload
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    } catch {}
    // Unregister the current SW so a fresh one loads
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(r => r.unregister()));
    }
    window.location.reload();
  }

  return (
    <div className={styles.banner}>
      <span>A new version is available</span>
      <button className={styles.updateBtn} onClick={handleUpdate}>
        Update
      </button>
    </div>
  );
}

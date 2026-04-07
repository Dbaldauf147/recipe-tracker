import { useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import styles from './UpdatePrompt.module.css';

export function UpdatePrompt() {
  const [dismissed, setDismissed] = useState(false);
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

  if (!needRefresh || dismissed) return null;

  async function handleUpdate() {
    await updateServiceWorker(true);
    // Fallback: if updateServiceWorker doesn't reload, force it
    setTimeout(() => window.location.reload(), 1000);
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

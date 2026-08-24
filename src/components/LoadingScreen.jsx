import { useEffect, useState } from 'react';
import styles from './LoadingScreen.module.css';

// What the app shows while it reads your account.
//
// This is the screen you were looking at when the site "wouldn't load": it was
// a bare black panel playing /loading-bg.mp4, a file that has never been in
// public/ (the one that exists is login-bg.mp4). A video with no source has no
// intrinsic size, and its container was a flex child, so the whole screen
// collapsed to a ~300px black bar down the left of a white page — no spinner,
// no words, nothing to say what was happening or that anything was wrong.
//
// So: fixed to the viewport rather than sized by its contents, and after a
// while it says so and offers a way out.
const STUCK_AFTER_MS = 12000;

export function LoadingScreen() {
  const [stuck, setStuck] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <video
        className={styles.video}
        src="/login-bg.mp4"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
      />
      <div className={styles.overlay}>
        {stuck ? (
          <div className={styles.stuck}>
            <p className={styles.stuckTitle}>Still connecting…</p>
            <p className={styles.stuckBody}>
              Prep Day can’t reach the server. Check your connection and try again —
              nothing you’ve saved is lost.
            </p>
            <button type="button" className={styles.reload} onClick={() => window.location.reload()}>
              Try again
            </button>
          </div>
        ) : (
          <>
            <div className={styles.spinner} />
            <p className={styles.loadingText}>Loading your week…</p>
          </>
        )}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import { sharedRecipeAppLink, detectMobilePlatform, APP_STORE_URL } from '../utils/openInApp';
import styles from './OpenInAppBanner.module.css';

const DISMISS_KEY = 'prepday-open-in-app-dismissed';

// How long to wait before deciding the app never opened. Long enough for a
// cold app launch on a slow phone, short enough that someone staring at an
// unchanged page isn't left wondering.
const HANDOFF_TIMEOUT_MS = 1800;

/**
 * The choice a shared recipe link offers on a phone: open it in the Prep Day
 * app, or keep reading right here.
 *
 * Only rendered on phones. On a desktop the website is the only answer, and a
 * button that does nothing would be worse than no button at all.
 *
 * The handoff can fail silently — the app isn't installed, or an in-app
 * browser (Instagram, Facebook) blocks custom schemes outright. Nothing tells
 * a web page whether a scheme resolved, so this infers it: if the tab is still
 * in the foreground a moment later, the app did not take over, and the banner
 * says so instead of leaving a dead "Opening…".
 */
export function OpenInAppBanner({ token }) {
  const [platform] = useState(() => {
    if (typeof navigator === 'undefined') return null;
    return detectMobilePlatform(navigator.userAgent, navigator.maxTouchPoints);
  });
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  // 'idle' → 'opening' → 'failed'. There is no 'succeeded': if it works the
  // app is in front and this page is never seen again.
  const [state, setState] = useState('idle');
  const timerRef = useRef(null);

  // If the app does open, the tab goes to the background. Cancel the "it
  // failed" verdict on the way out — otherwise coming back to Safari later
  // shows the failure message for a handoff that actually worked.
  useEffect(() => {
    function cancelOnLeave() {
      if (document.visibilityState === 'hidden') {
        clearTimeout(timerRef.current);
        setState('idle');
      }
    }
    document.addEventListener('visibilitychange', cancelOnLeave);
    window.addEventListener('pagehide', cancelOnLeave);
    return () => {
      clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', cancelOnLeave);
      window.removeEventListener('pagehide', cancelOnLeave);
    };
  }, []);

  const appLink = sharedRecipeAppLink(token);
  if (!platform || !appLink || dismissed) return null;

  function handleOpen() {
    setState('opening');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (document.visibilityState === 'visible') setState('failed');
    }, HANDOFF_TIMEOUT_MS);
    // Assigning location inside the click handler keeps this a user-gesture
    // navigation, which is the only form iOS will follow for a custom scheme.
    window.location.href = appLink;
  }

  function handleDismiss() {
    clearTimeout(timerRef.current);
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* private mode */ }
  }

  if (state === 'failed') {
    return (
      <div className={styles.banner}>
        <div className={styles.text}>
          <strong className={styles.title}>The app didn't open</strong>
          <span className={styles.subtitle}>
            You may not have Prep Day installed yet — or this browser blocks app
            links. The recipe is right here either way.
          </span>
        </div>
        <div className={styles.actions}>
          {/* iOS only: there is no Play listing to send an Android user to. */}
          {platform === 'ios' && (
            <a className={styles.primary} href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
              Get the app
            </a>
          )}
          <button type="button" className={styles.secondary} onClick={handleDismiss}>
            Keep reading here
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.banner}>
      <div className={styles.text}>
        <strong className={styles.title}>Open this in the Prep Day app</strong>
        <span className={styles.subtitle}>
          Saves straight to your recipes — ingredients, steps and nutrition included.
        </span>
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          onClick={handleOpen}
          disabled={state === 'opening'}
        >
          {state === 'opening' ? 'Opening…' : 'Open in the app'}
        </button>
        <button type="button" className={styles.secondary} onClick={handleDismiss}>
          Keep reading here
        </button>
      </div>
    </div>
  );
}

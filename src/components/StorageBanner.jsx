import { useEffect, useState } from 'react';
import { auth, db } from '../firebase';
import { doc, getDoc } from 'firebase/firestore';
import { computeStorageBreakdown, saveStorageEstimate } from '../utils/firestoreSync';
import styles from './StorageBanner.module.css';

// Per-Firestore-doc warning thresholds. Each user-data doc is capped at 1 MB
// by Firestore; we want a runway before any single field gets close.
const DOC_LIMIT = 1024 * 1024;
const SOFT = 0.5;  // 50% — informational mention only
const WARN = 0.75; // 75% — visible banner, suggest cleanup
const HIGH = 0.9;  // 90% — loud red banner

const DOC_LABELS = {
  user: 'main profile',
  recipes: 'recipes',
  dailyLog: 'daily log',
  workoutLog: 'workout log',
  workoutDraft: 'workout draft',
};

function severityFor(ratio) {
  if (ratio >= HIGH) return 'high';
  if (ratio >= WARN) return 'warn';
  if (ratio >= SOFT) return 'soft';
  return null;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export function StorageBanner({ user }) {
  const [breakdown, setBreakdown] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  // Use a local snapshot for immediate feedback; refresh from Firestore in the
  // background so other devices stay in sync.
  useEffect(() => {
    if (!user?.uid) return;
    setBreakdown(computeStorageBreakdown());
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        const remote = snap.exists() ? snap.data().storageEstimate : null;
        if (remote?.docs) setBreakdown({ docs: remote.docs, total: remote.total });
      } catch {}
    })();
  }, [user?.uid]);

  // Recompute + persist whenever localStorage changes from elsewhere
  useEffect(() => {
    if (!user?.uid) return;
    const refresh = () => setBreakdown(computeStorageBreakdown());
    window.addEventListener('storage', refresh);
    window.addEventListener('firestore-sync', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('firestore-sync', refresh);
    };
  }, [user?.uid]);

  if (!user?.uid || !breakdown || dismissed) return null;

  // Find the worst-offending doc; banner severity is driven by the heaviest one.
  let worst = { name: null, bytes: 0, ratio: 0 };
  for (const [name, bytes] of Object.entries(breakdown.docs)) {
    const ratio = bytes / DOC_LIMIT;
    if (ratio > worst.ratio) worst = { name, bytes, ratio };
  }
  const sev = severityFor(worst.ratio);
  if (!sev || sev === 'soft') return null; // soft = silent

  const label = DOC_LABELS[worst.name] || worst.name;
  const pct = Math.round(worst.ratio * 100);

  return (
    <div className={`${styles.banner} ${styles[sev]}`}>
      <div className={styles.text}>
        <strong>
          {sev === 'high'
            ? `Your ${label} data is at ${pct}% of its per-document storage limit.`
            : `Heads up — your ${label} data is at ${pct}% of its per-document storage limit.`}
        </strong>
        <span className={styles.detail}>
          {' '}({formatBytes(worst.bytes)} of {formatBytes(DOC_LIMIT)}). Total data: {formatBytes(breakdown.total)}.
          {sev === 'high'
            ? ' Consider archiving older entries soon — writes to this section may start failing if it crosses the limit.'
            : ' No action needed yet, but archiving old entries will keep things smooth long-term.'}
        </span>
      </div>
      <button
        className={styles.dismiss}
        onClick={() => {
          setDismissed(true);
          saveStorageEstimate(user.uid).catch(() => {});
        }}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

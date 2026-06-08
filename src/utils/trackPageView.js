import { doc, setDoc, increment } from 'firebase/firestore';
import { db, auth } from '../firebase';

// Lightweight page-view tracking for the admin usage table. Counts are
// accumulated in memory and flushed to the signed-in user's doc as nested
// `pageViews.<key>` increments — debounced so rapid navigation is one write.
const pending = {};
let timer = null;

export function trackPageView(pageKey) {
  if (!pageKey || typeof pageKey !== 'string') return;
  // Firestore nested-field keys can't contain '.', '/', etc. — normalize.
  const key = pageKey.replace(/[.#$/[\]]/g, '_');
  pending[key] = (pending[key] || 0) + 1;
  if (!timer) timer = setTimeout(flush, 8000);
}

async function flush() {
  timer = null;
  const keys = Object.keys(pending);
  if (keys.length === 0) return;
  const uid = auth.currentUser?.uid;
  if (!uid) { for (const k of keys) delete pending[k]; return; }
  const nested = {};
  for (const k of keys) { nested[k] = increment(pending[k]); delete pending[k]; }
  try {
    await setDoc(doc(db, 'users', uid), { pageViews: nested }, { merge: true });
  } catch {
    /* offline / permission — drop this batch rather than retry-storm */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
}

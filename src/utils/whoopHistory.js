// Reading the stored Whoop history, and driving the one-time backfill that
// fills it. The cache itself lives in whoopDaily.js, which stays free of
// Firebase so it can be tested.

import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

// One read of the full history document. Returns {} when the user has never
// connected Whoop, or when their data predates this document.
export async function loadWhoopHistory(uid) {
  if (!uid) return {};
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'data', 'whoopDaily'));
    return (snap.exists() && snap.data().daily) || {};
  } catch {
    return {};
  }
}

// Drive api/whoop/backfill.js to exhaustion, reporting progress as it goes.
// The endpoint is resumable by design (see its header) because a serverless
// function can't sit there for the whole walk; this is the loop that resumes
// it. `onProgress` gets each response, so the UI can show how far back it has
// reached rather than just spinning.
export async function runWhoopBackfill(user, onProgress) {
  if (!user?.uid) throw new Error('Not signed in');
  let before = null;
  let empty = 0;
  let last = null;

  // Bounded so a bug in the endpoint's stop condition can't spin forever:
  // 4 chunks of 60 days per call, so 40 calls covers ~26 years.
  for (let call = 0; call < 40; call++) {
    const t = await user.getIdToken();
    const params = new URLSearchParams({ uid: user.uid, t });
    if (before) params.set('before', before);
    if (empty) params.set('empty', String(empty));

    const res = await fetch(`/api/whoop/backfill?${params.toString()}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (!json.connected) throw new Error('Whoop is not connected');

    last = json;
    if (onProgress) onProgress(json);
    if (json.done || !json.nextBefore) break;

    before = json.nextBefore;
    empty = json.empty || 0;
  }

  return last;
}

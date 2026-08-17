import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, auth } from '../firebase';
import {
  normalizeSharedRows, diffExerciseRows, isEmptyDiff, replayDiff,
} from './sharedExerciseRows';

export {
  exerciseKey, normalizeSharedRows, diffExerciseRows, mergeExerciseLibraries,
} from './sharedExerciseRows';

/**
 * The SHARED exercise database — ONE document every signed-in account reads and
 * writes, so the exercise list behind the Log Workout picker is the same list
 * for everybody, on the website and on the phone.
 *
 * Location: sharedData/exerciseLibrary, field `exercises`. The mobile twin of
 * this file is PrepDay's src/services/exerciseLibrary.ts, and the two MUST
 * agree about the path, the field and the row shape — they write the same array.
 *
 * It deliberately does NOT live under users/{uid}: a per-user path is what made
 * the list diverge in the first place.
 *
 * ⚠ This needs the /sharedData rule in firestore.rules DEPLOYED
 * (`firebase deploy --only firestore:rules`). Without it every read and write
 * here is denied, and a denied read looks exactly like an empty library — which
 * is how the first attempt at this spent a week looking like it had shipped
 * when it hadn't. Hence the mandatory onError below.
 */
const SHARED_COLLECTION = 'sharedData';
const SHARED_DOC = 'exerciseLibrary';
const SHARED_FIELD = 'exercises';

function sharedRef() {
  return doc(db, SHARED_COLLECTION, SHARED_DOC);
}

function actorUid() {
  return auth.currentUser?.uid || '';
}

export async function loadSharedExercises() {
  const snap = await getDoc(sharedRef());
  if (!snap.exists()) return [];
  return normalizeSharedRows(snap.data()?.[SHARED_FIELD]);
}

/**
 * Live subscription. An exercise anyone adds — from their phone or from another
 * browser — lands in the pickers here without a reload.
 *
 * `onError` is not optional in spirit: a permission-denied here is invisible
 * otherwise, and invisible is precisely how a per-account fallback passes for a
 * working shared library.
 */
export function subscribeToSharedExercises(onChange, onError) {
  return onSnapshot(
    sharedRef(),
    snap => onChange(snap.exists() ? normalizeSharedRows(snap.data()?.[SHARED_FIELD]) : []),
    err => {
      console.error('[sharedExercises] subscribe failed', err);
      if (onError) onError(err);
    },
  );
}

/**
 * Publish an edit made against `prev` to the shared library, for EVERY user.
 *
 * Transactional, and replays a diff rather than writing the array wholesale —
 * with all accounts writing one array field, a read-modify-write from a stale
 * local copy would silently drop whatever anybody else added in between.
 *
 * Returns the rows as they now stand, or null when there was nothing to write.
 */
export async function applySharedExerciseEdit(prev, next) {
  const diff = diffExerciseRows(prev, next);
  // Nothing to say. This is also what stops a blank local state from erasing
  // everyone's library: a `prev` that never loaded is empty, an empty prev
  // can't produce removals, and so the worst an unloaded page can do is nothing
  // at all.
  if (isEmptyDiff(diff)) return null;

  let written = null;
  await runTransaction(db, async tx => {
    const snap = await tx.get(sharedRef());
    const serverRows = snap.exists() ? normalizeSharedRows(snap.data()?.[SHARED_FIELD]) : [];
    const value = replayDiff(serverRows, diff);
    tx.set(
      sharedRef(),
      { [SHARED_FIELD]: value, updatedAt: new Date().toISOString(), updatedBy: actorUid() },
      { merge: true },
    );
    written = value;
  });
  return written;
}

/**
 * One live subscription to users/{uid}/workouts, shared by every page that
 * shows logged workouts.
 *
 * The workouts moved to their own subcollection (v2 schema, mirroring mobile),
 * but only the Workout page ever subscribed to it. Everywhere else read the
 * localStorage mirror and refreshed it on the `firestore-sync` event — which
 * fires for USER-DOC changes and therefore never fires when a workout is added
 * or edited. So the Week Plan's workout row showed whatever the mirror happened
 * to hold: stale until you visited the Workout page, and missing anything
 * logged on the phone or another device in a session where you never did.
 *
 * Subscribing here keeps the mirror hot for whoever reads it next, and hands
 * each caller the fresh list.
 */
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { noteWorkoutsSynced } from './firestoreSync';

export const WORKOUTS_STORAGE_KEY = 'sunday-workout-log';

/** The localStorage mirror, for first paint before the snapshot lands. */
export function loadWorkoutsMirror() {
  try {
    const raw = JSON.parse(localStorage.getItem(WORKOUTS_STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

/**
 * Subscribe to the signed-in user's workouts. `onWorkouts` gets the full list,
 * newest first. Returns an unsubscribe function; safe to call with no uid.
 */
export function subscribeWorkouts(uid, onWorkouts) {
  if (!uid) return () => {};
  return onSnapshot(
    collection(db, 'users', uid, 'workouts'),
    snap => {
      const remote = [];
      // Always stamp the Firestore doc id onto the workout so each one has a
      // stable unique key — multiple workouts can share a date, and the
      // History tab edits/selects rows by this id, not by date.
      snap.forEach(d => remote.push({ ...d.data(), id: d.id }));
      // An empty snapshot is treated as "nothing to say", not "you have no
      // workouts" — the same guard the Workout page has always had, so a
      // transient empty read can't blank the mirror.
      if (remote.length === 0) return;
      const sorted = remote.sort((a, b) =>
        (b.date || '').localeCompare(a.date || '') ||
        (a.savedAt || '').localeCompare(b.savedAt || '')
      );
      const json = JSON.stringify(sorted);
      try {
        if (localStorage.getItem(WORKOUTS_STORAGE_KEY) !== json) {
          localStorage.setItem(WORKOUTS_STORAGE_KEY, json);
        }
      } catch { /* quota or disabled storage — the callback still fires */ }
      // This snapshot IS the remote state, so it is what the save-path's diff
      // cache should be measured against. Without this the cache only ever
      // heard about our own writes, and any divergence made the next save a
      // silent no-op — see noteWorkoutsSynced.
      noteWorkoutsSynced(uid, sorted);
      onWorkouts(sorted);
    },
    err => { console.error('Workout live sync error:', err); },
  );
}

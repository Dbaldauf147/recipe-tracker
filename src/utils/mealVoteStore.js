// Firestore reads and writes for the weekly meal vote (see mealVote.js).
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { saveField } from './firestoreSync';
import { normalizeMealVoteSettings } from './mealVote';

/** Live ballots: calls back with the `weeks` map (empty until one exists). */
export function subscribeMealVote(uid, onChange) {
  if (!uid) return () => {};
  return onSnapshot(
    doc(db, 'users', uid, 'data', 'mealVote'),
    (snap) => onChange(snap.exists() ? (snap.data().weeks || {}) : {}),
    (err) => console.warn('[mealVote] subscribe failed', err?.code || err),
  );
}

/**
 * Settings live on the user document, where the hourly cron can find the
 * accounts that have the vote switched on with one query.
 */
export async function saveMealVoteSettings(uid, settings) {
  const clean = normalizeMealVoteSettings(settings);
  await saveField(uid, 'mealVoteSettings', clean);
  return clean;
}

// What this tab last published, so the same ranking isn't written again every
// time the Recipes page re-renders.
let lastPublished = '';

/** Save the Suggested Meals ranking inputs for the cron. No-op if unchanged. */
export async function publishMealVoteSnapshot(uid, snapshot) {
  if (!uid || !snapshot) return false;
  const key = `${uid}:${JSON.stringify(snapshot)}`;
  if (key === lastPublished) return false;
  await setDoc(doc(db, 'users', uid, 'data', 'mealVoteSnapshot'), {
    ...snapshot,
    publishedAt: new Date().toISOString(),
  });
  lastPublished = key;
  return true;
}

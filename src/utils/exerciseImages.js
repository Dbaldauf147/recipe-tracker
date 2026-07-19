import { doc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db, auth } from '../firebase';

// User-uploaded custom photos for exercises. Stored one-per-doc under
// `users/{uid}/exerciseImages/{slug}` — a sibling of the mealImages
// subcollection (see utils/generateMealImage.js), so it's covered by the same
// owner-scoped Firestore rule and syncs to the mobile app, which reads the same
// path. When present, a custom photo REPLACES the auto-matched form demo / AI
// illustration everywhere the exercise shows (thumbnail + demo popup).
//
// Keyed by a slug of the exercise NAME (not a row id) so the same photo follows
// the exercise across the library table, the demo popup, and mobile — matching
// how the demo lookup itself is keyed by lowercased name.

const MAX_SIZE = 800; // max width/height in pixels
const QUALITY = 0.7;  // JPEG compression quality

// In-memory cache (slug -> dataUrl), populated by syncExerciseImages on login.
// Firestore is the source of truth; this is for instant synchronous reads.
const memoryCache = {};

/**
 * Stable Firestore doc id for an exercise name. Firestore ids can't contain '/'
 * and shouldn't be '.'/'..', so collapse to lowercase alphanumerics joined by
 * '-'. Two names that differ only by punctuation/case share one photo, which is
 * the intended behavior (the demo lookup is also case-insensitive).
 */
export function exerciseImageKey(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || '_';
}

/** Compress an image File to a smaller JPEG data URL via canvas. */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > MAX_SIZE || height > MAX_SIZE) {
        const ratio = Math.min(MAX_SIZE / width, MAX_SIZE / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/** Notify render-time consumers (thumbnails, popup) that the cache changed. */
function notifyChanged() {
  try { window.dispatchEvent(new Event('exercise-images-synced')); } catch { /* SSR */ }
}

/** Synchronous cache read for an exercise name. */
export function getCachedExerciseImage(name) {
  return memoryCache[exerciseImageKey(name)] || null;
}

/**
 * Compress + save a custom photo for an exercise, to memory + Firestore.
 * Returns the compressed data URL. Requires a signed-in user to persist.
 */
export async function uploadExerciseImage(name, file) {
  const dataUrl = await compressImage(file);
  const key = exerciseImageKey(name);
  memoryCache[key] = dataUrl;
  notifyChanged();
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      await setDoc(doc(db, 'users', uid, 'exerciseImages', key), { dataUrl, name: (name || '').trim() });
    } catch (err) {
      console.error('[exerciseImage] save failed:', err);
    }
  }
  return dataUrl;
}

/** Remove a custom photo from memory + Firestore (reverts to the auto demo). */
export async function deleteExerciseImage(name) {
  const key = exerciseImageKey(name);
  delete memoryCache[key];
  notifyChanged();
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      await deleteDoc(doc(db, 'users', uid, 'exerciseImages', key));
    } catch (err) {
      console.error('[exerciseImage] delete failed:', err);
    }
  }
}

/** Load all custom exercise photos from Firestore into the memory cache. */
export async function syncExerciseImages(uid) {
  if (!uid) return;
  try {
    const snap = await getDocs(collection(db, 'users', uid, 'exerciseImages'));
    snap.forEach(d => { memoryCache[d.id] = d.data().dataUrl; });
    notifyChanged();
  } catch (err) {
    console.error('[exerciseImage] sync failed:', err);
  }
}

/** Clear the in-memory cache (called on logout). */
export function clearExerciseImageCache() {
  for (const k of Object.keys(memoryCache)) delete memoryCache[k];
}

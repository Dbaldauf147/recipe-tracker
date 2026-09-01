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

// Framing (see renderFramedImage): the saved `dataUrl` is pre-cropped to the
// same aspect ratio the demo popup renders, so every consumer — web thumbnail,
// web popup, and the read-only mobile app — shows exactly what was framed here
// without needing to know anything about the transform.
export const FRAME_ASPECT = 1.3; // width / height, matches the ExerciseDemo box
const FRAME_OUT_W = 800;         // baked output width in pixels
// Panning/zoom is stored alongside the photo so "Adjust" can reopen where you
// left off. Fractions of the frame, so they're resolution-independent.
export const DEFAULT_TRANSFORM = { zoom: 1, ox: 0, oy: 0 };
// Skip persisting the un-cropped original once the doc would get close to
// Firestore's 1 MB limit — the crop still saves, it just can't be re-widened.
const MAX_DOC_CHARS = 700 * 1024;

// In-memory cache (slug -> { dataUrl, source, transform }), populated by
// syncExerciseImages on login. Firestore is the source of truth; this is for
// instant synchronous reads.
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
export function compressImage(file) {
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

/**
 * Rotate a stored JPEG data URL by whole quarter turns, clockwise.
 *
 * The turn is BAKED into the pixels rather than kept as a "rotation" field on
 * the record, because a photo is read in a dozen places — list card, map
 * callout, the friend's copy of a shared list, the phone — and every one of
 * them would have to learn about the field or show the picture sideways. One
 * re-encode at the moment you press the button buys correctness everywhere.
 *
 * Re-encoding costs a little quality each time; at Q=0.7 on an already-≤800px
 * image that is invisible, and four presses return to the original orientation.
 */
export function rotateDataUrl(dataUrl, quarterTurns = 1) {
  const turns = ((Math.round(quarterTurns) % 4) + 4) % 4;
  if (!dataUrl || turns === 0) return Promise.resolve(dataUrl);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const swap = turns % 2 === 1;
      const canvas = document.createElement('canvas');
      canvas.width = swap ? img.height : img.width;
      canvas.height = swap ? img.width : img.height;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((turns * Math.PI) / 2);
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });
}

/**
 * Where an image sits inside a frame, for a given transform. Shared by the live
 * preview (frame = the on-screen box) and the bake (frame = the output canvas)
 * so what you drag is exactly what gets saved.
 *
 * Starts from a "cover" fit — the whole frame is always filled — then applies
 * `zoom` and an offset expressed as a fraction of the frame, so the same numbers
 * describe the same framing at any pixel size.
 */
export function framedLayout({ naturalW, naturalH, frameW, frameH, transform }) {
  const t = { ...DEFAULT_TRANSFORM, ...(transform || {}) };
  const cover = Math.max(frameW / naturalW, frameH / naturalH);
  const scale = cover * (t.zoom > 0 ? t.zoom : 1);
  const width = naturalW * scale;
  const height = naturalH * scale;
  // Clamp the pan so an edge can never be dragged inside the frame.
  const maxOx = Math.max(0, (width - frameW) / 2) / frameW;
  const maxOy = Math.max(0, (height - frameH) / 2) / frameH;
  const ox = Math.min(maxOx, Math.max(-maxOx, t.ox || 0));
  const oy = Math.min(maxOy, Math.max(-maxOy, t.oy || 0));
  return {
    width, height, ox, oy, maxOx, maxOy,
    left: frameW / 2 + ox * frameW - width / 2,
    top: frameH / 2 + oy * frameH - height / 2,
  };
}

/**
 * Bake a transform into a new JPEG cropped to FRAME_ASPECT — this is what gets
 * stored as `dataUrl` and rendered everywhere, including the mobile app, which
 * knows nothing about transforms.
 */
export function renderFramedImage(srcDataUrl, transform) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const frameW = FRAME_OUT_W;
      const frameH = Math.round(FRAME_OUT_W / FRAME_ASPECT);
      const { width, height, left, top } = framedLayout({
        naturalW: img.naturalWidth, naturalH: img.naturalHeight, frameW, frameH, transform,
      });
      const canvas = document.createElement('canvas');
      canvas.width = frameW;
      canvas.height = frameH;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, frameW, frameH);
      ctx.drawImage(img, left, top, width, height);
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = srcDataUrl;
  });
}

/** Notify render-time consumers (thumbnails, popup) that the cache changed. */
function notifyChanged() {
  try { window.dispatchEvent(new Event('exercise-images-synced')); } catch { /* SSR */ }
}

/** Synchronous cache read for an exercise name — the framed, ready-to-show photo. */
export function getCachedExerciseImage(name) {
  return memoryCache[exerciseImageKey(name)]?.dataUrl || null;
}

/**
 * The whole cached record — { dataUrl, source, transform } — for the adjuster,
 * which reopens on the un-cropped `source` (when we still have it) so a photo
 * can be re-framed without losing what an earlier crop cut off.
 */
export function getCachedExerciseImageRecord(name) {
  return memoryCache[exerciseImageKey(name)] || null;
}

/**
 * Save a framed photo for an exercise, to memory + Firestore. `dataUrl` is the
 * baked crop everything renders; `source`/`transform` are kept so Adjust can
 * reopen it. Requires a signed-in user to persist.
 */
export async function saveExerciseImage(name, { dataUrl, source, transform }) {
  const key = exerciseImageKey(name);
  const record = { dataUrl, source: source || null, transform: transform || { ...DEFAULT_TRANSFORM } };
  memoryCache[key] = record;
  notifyChanged();
  const uid = auth.currentUser?.uid;
  if (uid) {
    const payload = { dataUrl, name: (name || '').trim(), transform: record.transform };
    // Keep the original only while the doc stays comfortably under Firestore's
    // 1 MB cap; the crop itself is never at risk.
    if (source && dataUrl.length + source.length < MAX_DOC_CHARS) payload.source = source;
    try {
      await setDoc(doc(db, 'users', uid, 'exerciseImages', key), payload);
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
    snap.forEach(d => {
      const v = d.data() || {};
      memoryCache[d.id] = {
        dataUrl: v.dataUrl,
        // Photos saved before framing existed have no stored original; the
        // adjuster falls back to re-framing the saved image itself.
        source: v.source || null,
        transform: v.transform || { ...DEFAULT_TRANSFORM },
      };
    });
    notifyChanged();
  } catch (err) {
    console.error('[exerciseImage] sync failed:', err);
  }
}

/** Clear the in-memory cache (called on logout). */
export function clearExerciseImageCache() {
  for (const k of Object.keys(memoryCache)) delete memoryCache[k];
}

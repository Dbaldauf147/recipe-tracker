import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, query, orderBy, limit, startAfter, documentId } from 'firebase/firestore';
import { db, auth } from '../firebase';

const MAX_SIZE = 800; // max width/height in pixels
const QUALITY = 0.7; // JPEG compression quality

// In-memory cache — primary source for getCachedMealImage.
// Survives localStorage quota limits (48+ images can exceed 5MB).
const memoryCache = {};

// What the last sync actually did. Kept so the app can SHOW the answer when
// images are missing: this has been diagnosed twice from guesswork because the
// only evidence lived in a console nobody was looking at. Read via
// getMealImageSyncReport().
let syncReport = { status: 'idle', loaded: 0, error: null, at: null };
export function getMealImageSyncReport() { return syncReport; }

/** Save a single meal image to its own Firestore document. */
async function saveImageToFirestore(uid, recipeId, dataUrl) {
  try {
    const ref = doc(db, 'users', uid, 'mealImages', recipeId);
    await setDoc(ref, { dataUrl });
  } catch (err) {
    console.error('[mealImage] Firestore save failed:', err);
  }
}

/** Delete a single meal image from Firestore. */
async function deleteImageFromFirestore(uid, recipeId) {
  try {
    const ref = doc(db, 'users', uid, 'mealImages', recipeId);
    await deleteDoc(ref);
  } catch (err) {
    console.error('[mealImage] Firestore delete failed:', err);
  }
}

// Images are base64 data URLs stored one per document, so this collection is
// measured in MEGABYTES, not kilobytes — ~11 MiB across ~100 recipes, with
// single images up to ~200 KB. Fetching it as one query asks the browser to
// hold the whole thing in a single response; Firestore's own REST API caps a
// page at ~2 MiB for exactly this reason. Ten at a time keeps each round trip
// around a megabyte.
const IMAGE_PAGE_SIZE = 10;

/**
 * Load all meal images for a user, a page at a time.
 *
 * `onBatch` receives each page as it lands, so the caller can fill its cache
 * and repaint progressively instead of showing nothing until the last byte of
 * the last image arrives.
 *
 * On failure this returns WHAT IT ALREADY HAS rather than {}. The previous
 * version threw away every image it had loaded the moment anything went wrong,
 * which turned one bad page into a completely empty gallery.
 */
async function loadImagesFromFirestore(uid, onBatch, onError) {
  const images = {};
  try {
    const colRef = collection(db, 'users', uid, 'mealImages');
    let cursor = null;
    for (;;) {
      const q = cursor
        ? query(colRef, orderBy(documentId()), startAfter(cursor), limit(IMAGE_PAGE_SIZE))
        : query(colRef, orderBy(documentId()), limit(IMAGE_PAGE_SIZE));
      const snap = await getDocs(q);
      if (snap.empty) break;
      const page = {};
      snap.forEach(d => {
        const url = d.data()?.dataUrl;
        if (url) { images[d.id] = url; page[d.id] = url; }
      });
      onBatch?.(page);
      // A short page is the last page.
      if (snap.size < IMAGE_PAGE_SIZE) break;
      cursor = snap.docs[snap.docs.length - 1];
    }
    return images;
  } catch (err) {
    console.error(
      '[mealImage] Firestore load failed after',
      Object.keys(images).length, 'images:', err,
    );
    onError?.(err);
    return images;
  }
}

/**
 * Compress an image file to a smaller JPEG data URL.
 */
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
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Upload and compress a meal photo, save to memory + Firestore.
 */
export async function uploadMealImage(recipeId, file, uid) {
  const dataUrl = await compressImage(file);

  memoryCache[recipeId] = dataUrl;

  if (uid) {
    await saveImageToFirestore(uid, recipeId, dataUrl);
  }

  return dataUrl;
}

/**
 * Delete a meal image from memory cache and Firestore.
 */
export function deleteMealImage(recipeId, uid) {
  delete memoryCache[recipeId];

  if (uid) {
    deleteImageFromFirestore(uid, recipeId);
  }
}

/**
 * Compress a base64 PNG/image into a smaller JPEG data URL via canvas.
 */
function compressBase64(base64, mimeType) {
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
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', QUALITY));
    };
    img.onerror = () => reject(new Error('Failed to decode generated image'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/**
 * Generate a meal image using Google Gemini API.
 */
export async function generateMealImage(recipeId, recipeName, ingredients, uid) {
  // The Gemini key lives ONLY on the server now — it must never be in the
  // browser bundle (a client-side `import.meta.env.VITE_GEMINI_API_KEY` is what
  // leaked the old key into prep-day.com's public JS and got the project
  // suspended). Call our server endpoint instead: it holds the key, meters per
  // user, and returns an already-compressed JPEG data URL.
  const idToken = await auth.currentUser?.getIdToken().catch(() => null);
  if (!idToken) throw new Error('Sign in to generate images.');

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch('/api/generate-meal-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ recipeName, ingredients }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastErr = new Error(`HTTP ${res.status}: ${errText}`);
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 10000));
        }
        continue;
      }

      const data = await res.json();
      const dataUrl = data?.dataUrl;
      if (!dataUrl) {
        lastErr = new Error('No image in response');
        continue;
      }

      memoryCache[recipeId] = dataUrl;
      if (uid) {
        await saveImageToFirestore(uid, recipeId, dataUrl);
      }

      return dataUrl;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Failed to generate image');
}

/**
 * Sync meal images from Firestore into memory cache.
 * Firestore is the source of truth; memory cache is for fast reads.
 */
export async function syncMealImages(uid) {
  if (!uid) {
    syncReport = { status: 'no-user', loaded: 0, error: null, at: Date.now() };
    return;
  }
  syncReport = { status: 'running', loaded: 0, error: null, at: Date.now() };
  try {
    // Fill the cache and repaint as each page lands, rather than after all
    // ~11 MiB has arrived: the first thumbnails show in a moment instead of
    // the whole gallery staying blank until the last image downloads. It also
    // means a failure part-way still leaves you with the images that did load.
    let loadError = null;
    const remote = await loadImagesFromFirestore(uid, page => {
      for (const [id, url] of Object.entries(page)) memoryCache[id] = url;
      syncReport = { ...syncReport, loaded: Object.keys(memoryCache).length };
      try { window.dispatchEvent(new Event('meal-images-synced')); } catch { /* SSR / no window */ }
    }, err => { loadError = err; });

    // Belt and braces — the batches above have already done this.
    for (const [id, url] of Object.entries(remote)) {
      memoryCache[id] = url;
    }

    syncReport = {
      status: loadError ? 'failed' : 'done',
      loaded: Object.keys(remote).length,
      error: loadError ? (loadError.code || loadError.message || String(loadError)) : null,
      at: Date.now(),
    };
    console.log('[mealImage] synced', Object.keys(remote).length, 'images from Firestore', loadError || '');

    // Tell render-time consumers (e.g. This Week's Meals thumbnails) that
    // the cache is now populated, so they can re-render. Without this,
    // components that called getCachedMealImage() before sync completed
    // would silently keep showing the empty placeholder.
    try { window.dispatchEvent(new Event('meal-images-synced')); } catch { /* SSR / no window */ }
  } catch (err) {
    syncReport = {
      status: 'failed',
      loaded: Object.keys(memoryCache).length,
      error: err?.code || err?.message || String(err),
      at: Date.now(),
    };
    console.error('syncMealImages:', err);
  }
}

/**
 * Clear the in-memory image cache (called on logout).
 */
export function clearImageCache() {
  for (const key of Object.keys(memoryCache)) {
    delete memoryCache[key];
  }
}

/**
 * Copy a meal image from one user to another (e.g. admin → current user).
 * Reads the source image from Firestore, saves to the destination user under a new recipe ID.
 */
export async function copyMealImage(sourceUid, sourceRecipeId, destUid, destRecipeId) {
  try {
    const ref = doc(db, 'users', sourceUid, 'mealImages', sourceRecipeId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const dataUrl = snap.data().dataUrl;
    if (!dataUrl) return null;

    memoryCache[destRecipeId] = dataUrl;
    await saveImageToFirestore(destUid, destRecipeId, dataUrl);
    return dataUrl;
  } catch (err) {
    console.error('[mealImage] copy failed:', err);
    return null;
  }
}

/**
 * Get cached image for a recipe.
 */
export function getCachedMealImage(recipeId) {
  return memoryCache[recipeId] || null;
}

/**
 * Load all meal images from the admin user's Firestore account.
 * Returns a map of recipeId → dataUrl.
 */
export async function loadAdminMealImages(adminUid) {
  if (!adminUid) return {};
  return loadImagesFromFirestore(adminUid);
}

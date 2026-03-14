import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const MAX_SIZE = 800; // max width/height in pixels
const QUALITY = 0.7; // JPEG compression quality

// In-memory cache — primary source for getCachedMealImage.
// Survives localStorage quota limits (48+ images can exceed 5MB).
const memoryCache = {};

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

/** Load all meal images from Firestore for a user. */
async function loadImagesFromFirestore(uid) {
  try {
    const colRef = collection(db, 'users', uid, 'mealImages');
    const snap = await getDocs(colRef);
    const images = {};
    snap.forEach(d => {
      images[d.id] = d.data().dataUrl;
    });
    return images;
  } catch (err) {
    console.error('[mealImage] Firestore load failed:', err);
    return {};
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
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini API key not configured');

  const ingredientList = (ingredients || [])
    .filter(i => (i.ingredient || '').trim())
    .map(i => i.ingredient.trim())
    .slice(0, 10)
    .join(', ');

  const prompt = `Professional overhead food photography of ${recipeName} on a clean white plate, containing ${ingredientList}, natural lighting, appetizing, high quality, no text`;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
          }),
        }
      );

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastErr = new Error(`HTTP ${res.status}: ${errText}`);
        if (res.status === 429) {
          await new Promise(r => setTimeout(r, 10000));
        }
        continue;
      }

      const data = await res.json();
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const imagePart = parts.find(p => p.inlineData);
      if (!imagePart) {
        lastErr = new Error('No image in response');
        continue;
      }

      const { mimeType, data: b64 } = imagePart.inlineData;
      const dataUrl = await compressBase64(b64, mimeType);

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
  if (!uid) return;
  try {
    const remote = await loadImagesFromFirestore(uid);

    // Load remote images into memory cache
    for (const [id, url] of Object.entries(remote)) {
      memoryCache[id] = url;
    }

    console.log('[mealImage] synced', Object.keys(remote).length, 'images from Firestore');
  } catch (err) {
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

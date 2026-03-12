import { doc, getDoc, setDoc, deleteDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../firebase';

const CACHE_KEY = 'sunday-meal-images';
const MAX_SIZE = 800; // max width/height in pixels
const QUALITY = 0.7; // JPEG compression quality

function loadImageCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function saveImageCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
  catch { /* storage full */ }
}

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
 * Upload and compress a meal photo, save to localStorage + Firestore.
 */
export async function uploadMealImage(recipeId, file, uid) {
  const dataUrl = await compressImage(file);

  const cache = loadImageCache();
  cache[recipeId] = dataUrl;
  saveImageCache(cache);

  if (uid) {
    saveImageToFirestore(uid, recipeId, dataUrl);
  }

  return dataUrl;
}

/**
 * Delete a meal image from cache and Firestore.
 */
export function deleteMealImage(recipeId, uid) {
  const cache = loadImageCache();
  delete cache[recipeId];
  saveImageCache(cache);

  if (uid) {
    deleteImageFromFirestore(uid, recipeId);
  }
}

/**
 * Generate a meal image using Hugging Face Inference API (free tier).
 * Uses FLUX.1-schnell model for fast, high-quality image generation.
 */
export async function generateMealImage(recipeId, recipeName, ingredients, uid) {
  const apiKey = import.meta.env.VITE_HF_API_KEY;
  if (!apiKey) throw new Error('Hugging Face API key not configured');

  const ingredientList = (ingredients || [])
    .filter(i => (i.ingredient || '').trim())
    .map(i => i.ingredient.trim())
    .slice(0, 10)
    .join(', ');

  const prompt = `Professional overhead food photography of ${recipeName} on a clean white plate, containing ${ingredientList}, natural lighting, appetizing, high quality, no text`;

  // Try up to 2 times
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(
        'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ inputs: prompt }),
        }
      );

      if (res.status === 503) {
        // Model is loading, wait and retry
        const body = await res.json().catch(() => ({}));
        const wait = Math.min((body.estimated_time || 20) * 1000, 60000);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastErr = new Error(`HTTP ${res.status}: ${errText}`);
        continue;
      }

      const blob = await res.blob();
      if (!blob.type.startsWith('image')) {
        lastErr = new Error('Response was not an image');
        continue;
      }

      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const cache = loadImageCache();
      cache[recipeId] = dataUrl;
      saveImageCache(cache);
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
 * Sync meal images between Firestore and localStorage.
 * Each image is its own Firestore doc, avoiding the 1MB user doc limit.
 */
export async function syncMealImages(uid) {
  if (!uid) return;
  try {
    const remote = await loadImagesFromFirestore(uid);
    const local = loadImageCache();

    // Merge: remote fills local, local fills remote
    const merged = { ...remote, ...local };

    // Update localStorage with merged set
    saveImageCache(merged);

    // Push any local-only images to Firestore
    for (const [id, url] of Object.entries(local)) {
      if (!remote[id]) {
        saveImageToFirestore(uid, id, url);
      }
    }
  } catch (err) {
    console.error('syncMealImages:', err);
  }
}

/**
 * Get cached image for a recipe.
 */
export function getCachedMealImage(recipeId) {
  const cache = loadImageCache();
  return cache[recipeId] || null;
}

import { saveField } from './firestoreSync';

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
    saveField(uid, 'mealImages', cache);
  }

  return dataUrl;
}

/**
 * Delete a meal image from cache.
 */
export function deleteMealImage(recipeId, uid) {
  const cache = loadImageCache();
  delete cache[recipeId];
  saveImageCache(cache);

  if (uid) {
    saveField(uid, 'mealImages', cache);
  }
}

/**
 * Build a Pollinations.ai image URL for a recipe.
 */
export function getPollinationsUrl(recipeName, ingredients) {
  const ingredientList = (ingredients || [])
    .filter(i => (i.ingredient || '').trim())
    .map(i => i.ingredient.trim())
    .slice(0, 10)
    .join(', ');

  const prompt = `Professional overhead food photography of ${recipeName} on a clean white plate, containing ${ingredientList}, natural lighting, appetizing, high quality, no text`;
  const seed = Math.floor(Math.random() * 100000);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${seed}`;
}

/**
 * Load a Pollinations image via <img>, draw to canvas, and cache as data URL.
 */
export function loadAndCacheImage(recipeId, url, uid) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/jpeg', QUALITY);

      const cache = loadImageCache();
      cache[recipeId] = dataUrl;
      saveImageCache(cache);
      if (uid) saveField(uid, 'mealImages', cache);

      resolve(dataUrl);
    };
    img.onerror = () => reject(new Error('Failed to generate image'));
    img.src = url;
  });
}

/**
 * Get cached image for a recipe.
 */
export function getCachedMealImage(recipeId) {
  const cache = loadImageCache();
  return cache[recipeId] || null;
}

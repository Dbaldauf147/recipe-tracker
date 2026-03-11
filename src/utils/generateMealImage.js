import { GoogleGenAI } from '@google/genai';
import { saveField } from './firestoreSync';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

const CACHE_KEY = 'sunday-meal-images';

function loadImageCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}'); }
  catch { return {}; }
}

function saveImageCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); }
  catch { /* storage full */ }
}

/**
 * Generate an AI image of a meal using Gemini.
 * Stores in localStorage and syncs to Firestore under the user doc.
 */
export async function generateMealImage(recipeId, recipeName, ingredients, uid) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  // Build prompt from recipe name + ingredients
  const ingredientList = (ingredients || [])
    .filter(i => (i.ingredient || '').trim())
    .map(i => i.ingredient.trim())
    .slice(0, 15)
    .join(', ');

  const prompt = `A beautiful, appetizing overhead food photography shot of "${recipeName}" plated on a clean white dish. The meal contains: ${ingredientList}. Professional food photography, natural lighting, shallow depth of field, high resolution, no text or watermarks.`;

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-image-generation',
    contents: prompt,
    config: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  // Find image part in response
  const parts = response.candidates?.[0]?.content?.parts || [];
  const imagePart = parts.find(p => p.inlineData);
  if (!imagePart) throw new Error('No image generated');

  const base64 = imagePart.inlineData.data;
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  const dataUrl = `data:${mimeType};base64,${base64}`;

  // Save to localStorage
  const cache = loadImageCache();
  cache[recipeId] = dataUrl;
  saveImageCache(cache);

  // Sync to Firestore under user doc
  if (uid) {
    saveField(uid, 'mealImages', cache);
  }

  return dataUrl;
}

/**
 * Get cached image for a recipe (no generation).
 */
export function getCachedMealImage(recipeId) {
  const cache = loadImageCache();
  return cache[recipeId] || null;
}

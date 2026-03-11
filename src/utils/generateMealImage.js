import { GoogleGenAI } from '@google/genai';
import { storage, db } from '../firebase';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Generate an AI image of a meal using Gemini, upload to Firebase Storage,
 * and cache the URL in Firestore.
 */
export async function generateMealImage(recipeId, recipeName, ingredients) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  // Check Firestore cache first
  const cacheRef = doc(db, 'recipeImages', recipeId);
  const cached = await getDoc(cacheRef);
  if (cached.exists()) return cached.data().url;

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

  // Convert base64 to blob
  const base64 = imagePart.inlineData.data;
  const mimeType = imagePart.inlineData.mimeType || 'image/png';
  const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  const blob = new Blob([byteArray], { type: mimeType });

  // Upload to Firebase Storage
  const ext = mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : 'png';
  const storageRef = ref(storage, `recipe-images/${recipeId}.${ext}`);
  await uploadBytes(storageRef, blob, { contentType: mimeType });
  const url = await getDownloadURL(storageRef);

  // Cache URL in Firestore
  await setDoc(cacheRef, { url, recipeName, createdAt: new Date().toISOString() });

  return url;
}

/**
 * Get cached image URL for a recipe (no generation).
 */
export async function getCachedMealImage(recipeId) {
  try {
    const cacheRef = doc(db, 'recipeImages', recipeId);
    const cached = await getDoc(cacheRef);
    return cached.exists() ? cached.data().url : null;
  } catch {
    return null;
  }
}

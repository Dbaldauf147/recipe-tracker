import { GoogleGenAI } from '@google/genai';
import { db } from '../firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY;

/**
 * Generate an AI image of a meal using Gemini and store as base64 in Firestore.
 */
export async function generateMealImage(recipeId, recipeName, ingredients) {
  if (!GEMINI_API_KEY) throw new Error('Gemini API key not configured');

  // Check Firestore cache first
  const cacheRef = doc(db, 'recipeImages', recipeId);
  const cached = await getDoc(cacheRef);
  if (cached.exists()) return cached.data().dataUrl;

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

  // Store in Firestore
  await setDoc(cacheRef, { dataUrl, recipeName, createdAt: new Date().toISOString() });

  return dataUrl;
}

/**
 * Get cached image for a recipe (no generation).
 */
export async function getCachedMealImage(recipeId) {
  try {
    const cacheRef = doc(db, 'recipeImages', recipeId);
    const cached = await getDoc(cacheRef);
    return cached.exists() ? cached.data().dataUrl : null;
  } catch {
    return null;
  }
}

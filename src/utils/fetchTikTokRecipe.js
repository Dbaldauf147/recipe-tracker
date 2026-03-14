/**
 * Fetches a TikTok video caption and extracts recipe data from it.
 * Uses the dedicated /api/tiktok-caption endpoint (oEmbed + fallbacks),
 * similar to how Instagram uses /api/instagram-caption.
 */

import { parseRecipeText } from './parseRecipeText';

/**
 * Fetch caption from the dedicated TikTok caption API endpoint.
 */
async function fetchCaption(url) {
  const res = await fetch(`/api/tiktok-caption?url=${encodeURIComponent(url)}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      body.error || 'Could not fetch the TikTok caption. Try copying it manually instead.'
    );
  }

  const data = await res.json();
  if (!data.caption) {
    throw new Error(
      'No caption found for this TikTok video. Try copying it manually instead.'
    );
  }

  return data;
}

/**
 * Fetch a TikTok URL and return a recipe object matching the app's shape.
 */
export async function fetchTikTokRecipe(url) {
  const { caption, author } = await fetchCaption(url);

  const parsed = parseRecipeText(caption);

  return {
    title: parsed.title || (author ? `${author}'s Recipe` : ''),
    description: caption,
    category: 'lunch-dinner',
    frequency: 'common',
    mealType: '',
    servings: '1',
    prepTime: '',
    cookTime: '',
    sourceUrl: url,
    ingredients: parsed.ingredients,
    instructions: parsed.instructions,
  };
}

/**
 * Just extract the caption text from a TikTok video for manual editing.
 */
export async function fetchTikTokCaption(url) {
  const { caption } = await fetchCaption(url);
  return caption;
}

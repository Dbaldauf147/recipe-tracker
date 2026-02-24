/**
 * Fetches a TikTok video page and extracts recipe data from it.
 * Tries structured JSON-LD data first, then falls back to og:description
 * and the existing recipe text parser.
 */

import { parseRecipeText, normalizeFractions, parseIngredientLine } from './parseRecipeText';

async function fetchHtml(url) {
  const res = await fetch(`/api/fetch-url?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const body = await res.text();
    let message = 'Could not fetch the TikTok video.';
    try { message = JSON.parse(body).error || message; } catch {}
    throw new Error(message);
  }
  return await res.text();
}

/**
 * Extract the video description from TikTok page HTML.
 * Tries multiple sources: JSON-LD VideoObject, meta tags, and SIGI_STATE.
 */
function extractDescription(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  // 1. Try JSON-LD VideoObject
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  for (const script of scripts) {
    try {
      let data = JSON.parse(script.textContent);
      if (Array.isArray(data)) data = data[0];
      if (data?.['@type'] === 'VideoObject' || data?.['@type']?.includes?.('VideoObject')) {
        return {
          title: data.name || '',
          description: data.description || '',
          author: data.creator?.name || data.author?.name || '',
        };
      }
    } catch {}
  }

  // 2. Try og:description / og:title meta tags
  const ogDesc = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
  const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || '';
  const twitterDesc = doc.querySelector('meta[name="twitter:description"]')?.getAttribute('content') || '';
  const pageTitle = doc.querySelector('title')?.textContent || '';

  const description = ogDesc || twitterDesc;
  const title = ogTitle || pageTitle;

  if (description || title) {
    return { title, description, author: '' };
  }

  // 3. Try to find description in embedded __UNIVERSAL_DATA
  const bodyText = html;
  const universalMatch = bodyText.match(/"desc"\s*:\s*"([^"]+)"/);
  if (universalMatch) {
    const decoded = universalMatch[1].replace(/\\u[\dA-Fa-f]{4}/g, m =>
      String.fromCharCode(parseInt(m.slice(2), 16))
    );
    return { title: '', description: decoded, author: '' };
  }

  return null;
}

/**
 * Fetch a TikTok URL and return a recipe object matching the app's shape.
 */
export async function fetchTikTokRecipe(url) {
  const html = await fetchHtml(url);
  const extracted = extractDescription(html);

  if (!extracted || (!extracted.description && !extracted.title)) {
    throw new Error(
      'Could not extract recipe data from this TikTok video. Try copying the caption and using the Paste tab instead.'
    );
  }

  // Combine title and description for parsing
  const fullText = [extracted.title, extracted.description]
    .filter(Boolean)
    .join('\n\n');

  const parsed = parseRecipeText(fullText);

  return {
    title: parsed.title || extracted.title || '',
    description: extracted.description || '',
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
  const html = await fetchHtml(url);
  const extracted = extractDescription(html);

  if (!extracted || (!extracted.description && !extracted.title)) {
    throw new Error(
      'Could not extract caption from this TikTok video. Try copying the text manually from the app.'
    );
  }

  return [extracted.title, extracted.description].filter(Boolean).join('\n\n');
}

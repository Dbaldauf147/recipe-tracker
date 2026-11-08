/**
 * "Drinking spots" — bars, breweries, clubs — as opposed to places you eat.
 *
 * The Eating Out views that answer "where should we eat?" (List, Recent,
 * Rankings, Try Next, Joanne, Healthy) hide these by default.
 *
 * A spot counts as a drinking spot when it has a drinking signal (the Drinking
 * bucket, or a bar-type category) and NO food signal (a meal bucket, or any
 * category that is neither a drink nor a night-out word). So Pally — Cocktail
 * + American — stays, because it's also a restaurant; Union Pool (Dive) goes.
 * Untagged spots are never hidden.
 */

const FOOD_BUCKETS = new Set(['breakfast', 'lunch-dinner', 'dessert']);

// Category words that mean "a place you go to drink". Matched per word, so
// "Rooftop bar" and "Wine bar" match "bar" but "Gastro Pub" is caught below.
const DRINK_WORDS = new Set([
  'bar', 'bars', 'cocktail', 'cocktails', 'brewery', 'breweries', 'beer', 'wine',
  'pub', 'dive', 'club', 'clubs', 'dance', 'drinking', 'drinks', 'lounge',
  'speakeasy', 'taproom', 'biergarten', 'nightclub', 'rooftop',
]);
// Categories that say nothing about food either way — a night out, a vibe.
const NEUTRAL_WORDS = new Set([
  'ambiance', 'date', 'music', 'venue', 'comedy', 'show', 'movie', 'theater',
  'theatre', 'other', 'going', 'out', 'spot', 'hall', 'live', 'karaoke',
]);
// Words that make a drink-looking category a food one.
const FOOD_OVERRIDES = /gastro|grill|kitchen|food|restaurant/;

const words = s => String(s || '').toLowerCase().split(/[^a-z]+/).filter(Boolean);

/** 'drink' | 'neutral' | 'food' for one category name. */
export function categoryKind(name) {
  const lower = String(name || '').toLowerCase();
  if (FOOD_OVERRIDES.test(lower)) return 'food';
  const ws = words(lower);
  if (!ws.length) return 'neutral';
  if (ws.some(w => DRINK_WORDS.has(w))) return 'drink';
  if (ws.every(w => NEUTRAL_WORDS.has(w))) return 'neutral';
  return 'food';
}

/**
 * @param {{ buckets?: string[], categories?: string[] }} spot
 *   buckets: the spot's bucket keys; categories: its category names.
 */
export function isDrinkingSpot({ buckets = [], categories = [] } = {}) {
  if (buckets.some(b => FOOD_BUCKETS.has(b))) return false;
  const kinds = categories.map(categoryKind);
  if (kinds.includes('food')) return false;
  return buckets.includes('drinking') || kinds.includes('drink');
}

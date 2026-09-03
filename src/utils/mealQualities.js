// Qualities of a meal that come from WHAT is in it, not from a nutrition label.
//
// "Does this meal have fermented food in it?" is not a number any database
// reports — it is a property of the ingredient. Omega-3 is a number, but one
// most sources leave at zero: USDA carries 1404 for a fraction of its foods,
// Open Food Facts almost never does, and a hand-entered ingredients-DB row
// usually has the column blank. Answering "is there an omega-3 source in this
// meal?" from that column would say No for a salmon dinner.
//
// So both questions are answered from the ingredient name, and both are
// expressed as servings — the same shape as vegServings and fruitServings —
// so they flow through totals, goals and the solver like any other nutrient.
// The measured `omega3` grams stay available separately for anyone who wants
// to set a goal on the number the data actually reports.

import { getIngredientTags } from './ingredientTags.js';

// Matching the WHO-style 80g serving the veg and fruit counters already use,
// so "servings" means one thing across the app.
export const FERMENTED_SERVING_GRAMS = 80;
export const OMEGA3_SERVING_GRAMS = 80;

// Forms that carry the flavour of a food without its substance.
const NOT_REALLY = [
  'powder', 'flavor', 'flavour', 'flavored', 'flavoured', 'seasoning',
  'extract', 'essence',
];

function isNominal(lower) {
  return NOT_REALLY.some(word => lower.includes(word));
}

/**
 * Fermented foods come from the curated tag map in ingredientTags.js, which
 * already carries a `fermented` tag on yogurt, kimchi, miso, tempeh, kefir,
 * sauerkraut, kombucha, soy sauce and the rest. Reusing it means one list to
 * maintain, and the recipe tag filters and this counter can never disagree.
 *
 * Note this counts culinary fermented ingredients, not live cultures — soy
 * sauce and sourdough count; a cooked dish's probiotics may not survive.
 */
export function isFermented(ingredientName) {
  const lower = (ingredientName || '').toLowerCase().trim();
  if (!lower || isNominal(lower)) return false;
  return getIngredientTags(lower).includes('fermented');
}

// Foods with a well-established omega-3 content worth counting. Deliberately
// conservative: weak sources (light tuna, canola) are left out so a "yes" is
// worth something.
const OMEGA3_KEYWORDS = [
  // Marine
  'salmon', 'sardine', 'mackerel', 'anchovy', 'anchovies', 'herring',
  'trout', 'roe', 'caviar', 'oyster', 'mussel', 'cod liver',
  // Plant
  'chia', 'flax', 'linseed', 'hemp seed', 'hemp heart', 'walnut',
  'algae oil', 'algal oil',
];

const OMEGA3_EXCLUDE = ['imitation', 'salmon-flavored'];

export function isOmega3Source(ingredientName) {
  const lower = (ingredientName || '').toLowerCase().trim();
  if (!lower || isNominal(lower)) return false;
  if (OMEGA3_EXCLUDE.some(word => lower.includes(word))) return false;
  return OMEGA3_KEYWORDS.some(word => lower.includes(word));
}

function servings(grams, perServing) {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return 0;
  return Math.round((g / perServing) * 10) / 10;
}

export function computeFermentedServings(ingredientName, grams) {
  if (!isFermented(ingredientName)) return 0;
  return servings(grams, FERMENTED_SERVING_GRAMS);
}

export function computeOmega3Servings(ingredientName, grams) {
  if (!isOmega3Source(ingredientName)) return 0;
  return servings(grams, OMEGA3_SERVING_GRAMS);
}

// Per-100g contribution of these counters for an ingredient, so a candidate
// the solver is considering adding can be scored on them like any nutrient.
export function qualitiesPer100g(ingredientName) {
  const out = {};
  const fermented = computeFermentedServings(ingredientName, 100);
  const omega3 = computeOmega3Servings(ingredientName, 100);
  if (fermented > 0) out.fermentedServings = fermented;
  if (omega3 > 0) out.omega3Servings = omega3;
  return out;
}

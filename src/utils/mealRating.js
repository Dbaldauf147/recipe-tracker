// A recipe's star rating against the Design a Meal goals.
//
// Design a Meal already answers "does this meal hit my goals" for one recipe
// at a time, ingredient by ingredient, from live lookups. That is the right
// depth for the page you opened deliberately and the wrong cost for a list of
// two hundred cards. This module answers the same question cheaply enough to
// run over the whole collection: it scores the nutrition the app has ALREADY
// computed for a recipe against the active goal profile, and turns the count
// of goals met into stars.
//
// So a five-goal profile gives the 1-5 scale directly — one star per goal met
// — and a profile with any other number of goals still lands on the same
// five-star scale, to the half star.
//
// Pure on purpose (no React, no localStorage reads inside the scoring path)
// so `node --test` can cover it.

import { evaluateMeal, activeProfile, profileHasGoals } from './mealGoals.js';

export const MAX_STARS = 5;

export const NUTRITION_CACHE_KEY = 'sunday-nutrition-cache';

// ── where the numbers come from ────────────────────────────────────────────
//
// Two sources, in order of trust:
//
//   1. `recipe.macrosPerServing` — written by the recipe page's nutrition
//      panel and synced to Firestore, so it is the same vector mobile reads.
//      Present for every recipe whose nutrition has ever been computed on
//      either platform, which is what makes rating a whole list free.
//
//   2. The local `sunday-nutrition-cache` — a per-recipe `{ data, fingerprint }`
//      of whole-recipe totals. Older entries predate the Firestore field, so
//      this catches recipes the panel scored before that write existed.
//
// A recipe matching neither is simply unrated: no stars, rather than zero
// stars, because "we haven't looked" and "it misses every goal" are different
// answers and only one of them is the recipe's fault.

function isNumericVector(v) {
  if (!v || typeof v !== 'object') return false;
  return Object.values(v).some(x => typeof x === 'number' && Number.isFinite(x));
}

// Per-serving nutrition from a cached whole-recipe result. Toppings are
// per-serving amounts already, so they are not divided — the same split the
// nutrition panel renders.
export function perServingFromCache(recipe, cached) {
  const data = cached?.data || cached;
  const items = data?.items;
  if (!Array.isArray(items) || items.length === 0) {
    return isNumericVector(data?.totals) ? scaleTotals(data.totals, recipe) : null;
  }
  const servings = servingsOf(recipe);
  // `items` is index-aligned with the ingredient rows that had a name, which
  // is exactly what the panel fed the lookup.
  const named = (recipe?.ingredients || []).filter(row => (row.ingredient || '').trim());
  const out = {};
  items.forEach((item, i) => {
    const nutrients = item?.nutrients;
    if (!nutrients) return;
    const topping = !!named[i]?.topping;
    for (const [key, val] of Object.entries(nutrients)) {
      if (typeof val !== 'number' || !Number.isFinite(val)) continue;
      out[key] = (out[key] || 0) + (topping ? val : val / servings);
    }
  });
  return isNumericVector(out) ? out : null;
}

function scaleTotals(totals, recipe) {
  const servings = servingsOf(recipe);
  const out = {};
  for (const [key, val] of Object.entries(totals)) {
    if (typeof val === 'number' && Number.isFinite(val)) out[key] = val / servings;
  }
  return out;
}

function servingsOf(recipe) {
  const n = parseInt(recipe?.servings, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Per-serving nutrition for a recipe, or null if the app has never computed
 * any. `cache` is the parsed `sunday-nutrition-cache` object; pass `{}` (or
 * nothing) to rely on the persisted field alone.
 */
export function perServingForRecipe(recipe, cache) {
  if (!recipe) return null;
  if (isNumericVector(recipe.macrosPerServing)) return recipe.macrosPerServing;
  const cached = cache?.[recipe.id];
  if (cached) {
    const fromCache = perServingFromCache(recipe, cached);
    if (fromCache) return fromCache;
  }
  if (isNumericVector(recipe.macrosTotals)) return scaleTotals(recipe.macrosTotals, recipe);
  return null;
}

// ── the rating ─────────────────────────────────────────────────────────────

/**
 * Score one per-serving nutrition vector against a goal profile.
 *
 * A goal is met or it isn't — the same pass / over / under the Design a Meal
 * score panel shows — so the star count is a fact the user can check, not a
 * weighted blend they'd have to take on faith. A macro goal on a meal with no
 * macros at all ("unknown") counts as not met, which is the honest reading:
 * black coffee does not hit a 30% protein target.
 *
 * Returns null when there is nothing to say: no goals set, or no nutrition.
 */
export function rateMeal(profile, perServing) {
  if (!profileHasGoals(profile) || !isNumericVector(perServing)) return null;
  const evaluation = evaluateMeal(profile, perServing);
  const total = evaluation.results.length;
  if (total === 0) return null;
  const met = evaluation.results.filter(r => r.status === 'pass').length;
  const score = met / total;
  return {
    met,
    total,
    score,
    // Halves, so a profile that isn't five goals long still reads on the same
    // scale instead of rounding two-thirds of the way to a whole star.
    stars: Math.round(score * MAX_STARS * 2) / 2,
    results: evaluation.results,
    macro: evaluation.macro,
  };
}

/** The same, straight from a recipe. */
export function rateRecipe(profile, recipe, cache) {
  return rateMeal(profile, perServingForRecipe(recipe, cache));
}

/** `{ [recipeId]: rating }` for a list, skipping recipes with no nutrition. */
export function rateRecipes(profile, recipes, cache) {
  const map = {};
  if (!profileHasGoals(profile)) return map;
  for (const recipe of recipes || []) {
    if (!recipe?.id) continue;
    const rating = rateRecipe(profile, recipe, cache);
    if (rating) map[recipe.id] = rating;
  }
  return map;
}

/**
 * Sort comparator, best first. Unrated recipes sort last rather than as zero —
 * an unscored recipe hasn't failed, it just hasn't been measured.
 */
export function compareByRating(ratings, a, b) {
  const ra = ratings?.[a?.id];
  const rb = ratings?.[b?.id];
  if (!ra && !rb) return (a?.title || '').localeCompare(b?.title || '');
  if (!ra) return 1;
  if (!rb) return -1;
  if (rb.score !== ra.score) return rb.score - ra.score;
  return (a?.title || '').localeCompare(b?.title || '');
}

// ── words for it ───────────────────────────────────────────────────────────

/** "3 of 5 goals met" — the sentence behind the stars. */
export function ratingSummary(rating) {
  if (!rating) return 'Not scored against your meal goals yet';
  return `${rating.met} of ${rating.total} meal goal${rating.total === 1 ? '' : 's'} met`;
}

/** A per-goal breakdown for a tooltip: "✓ Protein · ✗ Fiber (under)". */
export function ratingDetail(rating) {
  if (!rating) return '';
  return rating.results
    .map(r => `${r.status === 'pass' ? '✓' : '✗'} ${r.label}${r.status === 'pass' ? '' : ` (${r.status})`}`)
    .join('\n');
}

// ── convenience for components ─────────────────────────────────────────────

/** The active goal profile, or null. Reads localStorage, so not pure. */
export function loadActiveProfile(store) {
  return store ? activeProfile(store) : null;
}

/** The parsed nutrition cache, or `{}` when it is missing or unreadable. */
export function readNutritionCache() {
  try {
    return JSON.parse(localStorage.getItem(NUTRITION_CACHE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

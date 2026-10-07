// Per-serving and whole-recipe nutrition for a recipe, and re-syncing meals
// that were logged from it.
//
// ── why this file exists ───────────────────────────────────────────────────
//
// A recipe's ingredient rows come in two kinds, and the difference is the whole
// problem:
//
//   * MAIN ingredients are the batch. Two pounds of chicken across six
//     servings is a third of a pound each, so they divide by the serving count.
//   * TOPPING ingredients (`row.topping === true`) are written per meal — "one
//     scoop of protein powder", "half an avocado" — so they are ALREADY a
//     single serving and must not be divided.
//
// So: `perServing = main / servings + topping`, and the batch is
// `main + topping × servings`. The nutrition panel has always drawn the numbers
// that way, but the vector it PERSISTED to the recipe (`macrosPerServing`) was
// a flat `rawTotals / servings`, which silently drops the topping rule. On a
// recipe where every row is a topping — a smoothie, typically — that made the
// saved per-serving figure exactly `servings` times too small, so the recipe
// screen could read "3 fruit servings" while everything downstream read 0.75.
//
// Both paths call in here now, so the saved vector is the one on screen.

// No imports on purpose. The nutrient list lives in `utils/nutrition.js`, but
// that module reaches the ingredients store and from there Firestore, so
// importing it would drag a browser-only dependency chain into a pure
// calculation — and out of reach of `node --test`. Every function here works
// from the keys actually present in the data instead, which is the same answer:
// a nutrient with no entry is a nutrient with none of it.

const round2 = (n) => Math.round(n * 100) / 100;

/** Every nutrient key present across a set of vectors. */
function keysOf(...vectors) {
  const keys = new Set();
  for (const v of vectors) {
    if (!v || typeof v !== 'object') continue;
    for (const k of Object.keys(v)) keys.add(k);
  }
  return keys;
}

function servingsOf(servings) {
  const n = Number(servings);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Split a recipe's looked-up ingredients into the batch and the per-meal rows.
 *
 * `items` is index-aligned with the ingredient rows that had a name — exactly
 * what the nutrition lookup was handed — so the rows are filtered the same way
 * here before they are zipped together.
 */
function splitTotals(items, ingredients) {
  const main = {};
  const topping = {};
  const named = (ingredients || []).filter(row => (row.ingredient || '').trim());
  const rows = (items || []).map((item, i) => ({
    nutrients: item?.nutrients || {},
    topping: !!named[i]?.topping,
  }));
  const keys = keysOf(...rows.map(r => r.nutrients));
  for (const k of keys) { main[k] = 0; topping[k] = 0; }
  for (const r of rows) {
    const bucket = r.topping ? topping : main;
    for (const k of keys) {
      const v = r.nutrients[k];
      bucket[k] += typeof v === 'number' && Number.isFinite(v) ? v : 0;
    }
  }
  return { main, topping, keys };
}

/**
 * The two vectors the panel shows and the app stores, from one calculation.
 *
 * Kept unrounded to two decimals rather than whole numbers: a produce serving
 * is often a fraction (0.8 of a vegetable serving from a handful of kale), and
 * rounding those to integers before they are summed across a week is how a
 * week of real vegetables becomes a week of zeroes.
 */
export function recipeNutritionVectors(items, ingredients, servings) {
  const count = servingsOf(servings);
  const { main, topping, keys } = splitTotals(items, ingredients);
  const totals = {};
  const perServing = {};
  for (const k of keys) {
    totals[k] = round2(main[k] + topping[k] * count);
    perServing[k] = round2(main[k] / count + topping[k]);
  }
  return { totals, perServing };
}

// Logged meals are SNAPSHOTS and are never rewritten. Each one keeps the
// nutrition it was logged with; a later change to the recipe — an edit, a
// better ingredient match, a fix to the calculation — only affects meals logged
// after it. There used to be a "your logged meals are out of date, update
// them?" offer here (findStaleEntries / applyResync); it was removed on
// purpose. Don't bring it back: history is history.

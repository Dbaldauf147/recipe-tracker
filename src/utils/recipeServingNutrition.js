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

/** One serving's vector multiplied out to the portion actually eaten. */
export function scaleServing(perServing, factor) {
  const out = {};
  for (const k of keysOf(perServing)) {
    const v = perServing[k];
    out[k] = Math.round(((typeof v === 'number' && Number.isFinite(v) ? v : 0) * factor) * 10) / 10;
  }
  return out;
}

// Nutrients worth reporting in the "what changed" line. The whole vector is
// rewritten either way; these are just the ones a person recognises.
const HEADLINE = ['calories', 'protein', 'vegServings', 'fruitServings'];

function differs(a, b) {
  for (const k of keysOf(a, b)) {
    const x = a?.[k] || 0;
    const y = b?.[k] || 0;
    if (typeof x !== 'number' && typeof y !== 'number') continue;
    // A tenth is the resolution everything downstream rounds to anyway, so
    // anything smaller is noise and must not offer the user a pointless update.
    if (Math.abs((Number(x) || 0) - (Number(y) || 0)) > 0.05) return true;
  }
  return false;
}

/**
 * Which already-logged meals of this recipe no longer match it.
 *
 * A logged meal stores a SNAPSHOT of the recipe's nutrition as it stood that
 * day, which is right: editing a recipe next month shouldn't quietly rewrite
 * what you ate last month. But when the numbers change because the computation
 * improved — a better ingredient match, the topping fix above, an edit to your
 * ingredients sheet — the snapshot is just stale, and the week's fruit and veg
 * tiles add up stale figures without any sign that they have.
 *
 * Hand-weighed meals are left alone. An entry with `customWeight` or
 * `ingredientWeights` was scaled by grams rather than by servings, and its
 * stored `servings` is not the multiplier that produced its nutrition — so
 * there is no honest way to rescale it from here, and guessing would overwrite
 * a number the user measured with one the app assumed.
 */
export function findStaleEntries(log, recipe, perServing) {
  const out = [];
  const skipped = [];
  if (!recipe?.id || !perServing) return { stale: out, skipped };
  for (const [date, day] of Object.entries(log || {})) {
    for (const entry of day?.entries || []) {
      if (entry?.type !== 'recipe' || entry.recipeId !== recipe.id) continue;
      if (entry.customWeight || entry.ingredientWeights) { skipped.push({ date, entry }); continue; }
      const factor = Number(entry.servings) > 0 ? Number(entry.servings) : 1;
      const next = scaleServing(perServing, factor);
      if (!differs(entry.nutrition, next)) continue;
      out.push({
        date,
        id: entry.id,
        factor,
        from: entry.nutrition || {},
        to: next,
        headline: HEADLINE.map(k => ({
          key: k,
          from: Math.round((entry.nutrition?.[k] || 0) * 10) / 10,
          to: Math.round((next[k] || 0) * 10) / 10,
        })),
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { stale: out, skipped };
}

/**
 * A copy of the log with those entries brought in line. Pure — the caller
 * decides whether to keep it, so nothing is written before the user says yes.
 */
export function applyResync(log, stale) {
  if (!stale || stale.length === 0) return log;
  const byDate = new Map();
  for (const s of stale) {
    if (!byDate.has(s.date)) byDate.set(s.date, new Map());
    byDate.get(s.date).set(s.id, s.to);
  }
  const next = { ...log };
  for (const [date, updates] of byDate) {
    const day = next[date];
    if (!day) continue;
    next[date] = {
      ...day,
      entries: (day.entries || []).map(e => (
        updates.has(e.id)
          ? { ...e, nutrition: updates.get(e.id), nutritionResyncedAt: new Date().toISOString() }
          : e
      )),
    };
  }
  return next;
}

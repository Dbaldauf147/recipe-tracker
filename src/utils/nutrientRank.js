// Nutrient Search (gear menu): rank meals or ingredients by one nutrient —
// per serving, per 100 calories ("fiber per calorie"), or per 100 g.
//
// Pure on purpose (no store / Firestore imports) so it runs under node --test.
//
// Meals read the recipe's saved `macrosPerServing` — the vector the recipe's
// nutrition panel persists. A recipe that has never had its nutrition worked
// out has none, so it can't be ranked; the page counts those separately.
//
// Ingredient rows hold their numbers as strings for ONE `measurement`
// ("clove(s)") weighing `grams`, so "per serving" there means per that unit.

export const BASES = {
  serving: 'per serving',
  per100cal: 'per 100 cal',
  per100g: 'per 100 g',
};

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** A recipe's per-serving numbers, or null when none are saved. */
export function recipeVector(recipe) {
  const m = recipe?.macrosPerServing;
  if (!m || typeof m !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(m)) { const n = num(v); if (n != null) out[k] = n; }
  if (!Object.keys(out).length) return null;
  // Grams per serving, when the recipe knows its cooked weight.
  const total = num(recipe.totalWeight);
  const servings = num(recipe.servings);
  if (total && total > 0 && servings && servings > 0) out.__grams = total / servings;
  return out;
}

/** An ingredient row's numbers for its own measurement, or null when it has none. */
export function ingredientVector(row) {
  if (!row || typeof row !== 'object') return null;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === 'grams' || k === 'ingredient' || k === 'measurement') continue;
    const n = num(v);
    if (n != null) out[k] = n;
  }
  if (out.calories == null) return null;
  const g = num(row.grams);
  if (g && g > 0) out.__grams = g;
  return out;
}

/**
 * The ranked value for one vector, or null when it can't be ranked on this
 * basis (no value, no calories for a per-calorie figure, no weight for per-gram).
 */
export function rankValue(vec, nutrient, basis) {
  if (!vec) return null;
  const v = vec[nutrient];
  if (v == null) return null;
  if (basis === 'per100cal') {
    if (nutrient === 'calories') return null;
    const cal = vec.calories;
    return cal > 0 ? (v / cal) * 100 : null;
  }
  if (basis === 'per100g') {
    const g = vec.__grams;
    return g > 0 ? (v / g) * 100 : null;
  }
  return v;
}

/**
 * Rank `items` ({ name, vec, ... }) by `nutrient` on `basis`.
 *   order       — 'desc' (highest first, the default) or 'asc'
 *   query       — case-insensitive name filter
 *   minCalories — skip items under this many calories per serving (keeps
 *                 near-zero-calorie spices from topping a per-calorie list)
 * Items that can't be ranked are dropped. Ties fall back to name.
 */
export function rankItems(items, { nutrient, basis = 'serving', order = 'desc', query = '', minCalories = 0 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  const minCal = Number(minCalories) || 0;
  const out = [];
  for (const it of items || []) {
    if (!it?.vec) continue;
    if (q && !String(it.name || '').toLowerCase().includes(q)) continue;
    if (minCal > 0 && !((it.vec.calories || 0) >= minCal)) continue;
    const value = rankValue(it.vec, nutrient, basis);
    if (value == null) continue;
    out.push({ ...it, value });
  }
  const dir = order === 'asc' ? 1 : -1;
  out.sort((a, b) => (a.value - b.value) * dir || String(a.name || '').localeCompare(String(b.name || '')));
  return out;
}

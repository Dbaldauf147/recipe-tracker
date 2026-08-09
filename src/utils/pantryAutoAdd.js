// The pantry widgets' "what should I buy this week" rule, shared.
//
// The Shopping List auto-adds ONE snack and ONE fruit each week: whichever has
// gone longest without being eaten or bought. That choice used to live inside
// ShoppingListPage, which meant nothing else could ask "what's on the list this
// week" without reimplementing it — and a second implementation of a rule this
// fiddly would drift the first time either side changed.
//
// The Air Fryer page asks exactly that question, to flag the food that's
// actually coming into the house.
import { eatenKey, lookupEatenDate } from './eatenMatch.js';

export function daysSinceDate(d) {
  if (!d) return null;
  const then = new Date(d);
  if (isNaN(then)) return null;
  return Math.max(0, Math.floor((new Date() - then) / 86400000));
}

// Resolve the effective "last known" date for a tracked item — most recent
// of the meal-log date and a manual lastPurchased bump.
export function effectiveDate(item, eatenMap) {
  const eaten = lookupEatenDate(item.ingredient, eatenMap);
  if (eaten && item.lastPurchased) {
    return new Date(eaten) > new Date(item.lastPurchased) ? eaten : item.lastPurchased;
  }
  return eaten || item.lastPurchased || null;
}

// Pick the item from `list` with the highest Since (never-touched items win).
export function findTopSince(list, eatenMap) {
  let best = null;
  let bestDays = -1;
  for (const item of (list || [])) {
    if (!(item?.ingredient || '').trim()) continue;
    const d = effectiveDate(item, eatenMap);
    const days = d == null ? Number.POSITIVE_INFINITY : daysSinceDate(d);
    if (days > bestDays) { bestDays = days; best = item; }
  }
  return best;
}

// Build a map of normalized-ingredient-name → ISO date of the most recent
// daily-log entry that included that ingredient. Used by the Snacks widget
// to show "days since last eaten".
export function buildIngredientEatenMap(getRecipe) {
  const map = new Map();
  let log;
  try { log = JSON.parse(localStorage.getItem('sunday-daily-log') || '{}'); } catch { return map; }
  if (!log || typeof log !== 'object') return map;
  const dates = Object.keys(log).sort(); // ascending so later overwrites earlier
  for (const date of dates) {
    const entries = log[date]?.entries || [];
    for (const entry of entries) {
      const names = [];
      if (Array.isArray(entry.ingredientNutrition)) {
        for (const ing of entry.ingredientNutrition) {
          if (ing?.ingredient) names.push(ing.ingredient);
        }
      }
      // Always also pull the recipe's current ingredient list (even when
      // ingredientNutrition was stored at log time) — the stored list may be
      // stale, and the recipe itself may have been updated since.
      if (entry.recipeId && typeof getRecipe === 'function') {
        const r = getRecipe(entry.recipeId);
        if (r && Array.isArray(r.ingredients)) {
          for (const ing of r.ingredients) {
            if (ing?.ingredient) names.push(ing.ingredient);
          }
        }
      }
      if (names.length === 0 && entry.type === 'custom' && entry.mealName) {
        names.push(entry.mealName);
      }
      // Custom-meal entries can also store their own ingredient list.
      if (Array.isArray(entry.ingredients)) {
        for (const ing of entry.ingredients) {
          if (typeof ing === 'string') names.push(ing);
          else if (ing?.ingredient) names.push(ing.ingredient);
        }
      }
      for (const n of names) {
        const key = eatenKey(n);
        if (!key) continue;
        map.set(key, date); // dates are iterated ascending → last-write-wins = latest
      }
    }
  }
  return map;
}

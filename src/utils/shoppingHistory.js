/* The shopping-list side of Meal History (`planHistory`).

   "Reset Shopping List" archives each week's list as { date, recipeIds,
   extras?, timestamp } — `extras` being the names of the hand-added items
   AND that week's auto-added snack and fruit. Entries the site fills in from
   the Week Plan (`source: 'week-plan'`, utils/autoWeekHistory.js) are meals
   that were eaten, not lists that were shopped, so they're left out here.

   Two consumers:
     • Meal History's "Shopping Lists" tab — shoppingListWeeks().
     • The weekly snack/fruit auto-add (findTopSince in pantryAutoAdd.js),
       which skips whatever was on the LAST list — lastShoppingListExtras() —
       so the same snack or fruit is never picked two weeks in a row.

   The mobile app mirrors lastShoppingListExtras in its pantryAutoAdd.ts. */

/** A list saved by Reset Shopping List (not a Week Plan fill-in). */
export function isShoppingListEntry(entry) {
  return !!entry && typeof entry === 'object' && !!entry.date && entry.source !== 'week-plan';
}

const pad = n => String(n).padStart(2, '0');
function addDaysKey(key, days) {
  const [y, m, d] = String(key).split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

/**
 * The added items (extras) on the most recent shopping list saved within the
 * last `days` days up to `today` ('YYYY-MM-DD'). Every list saved on that same
 * day counts. [] when there's none that recent — a list from a month ago
 * isn't "last week's".
 */
export function lastShoppingListExtras(history, today, days = 14) {
  if (!today || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return [];
  const cutoff = addDaysKey(today, -(days - 1));
  const lists = (Array.isArray(history) ? history : [])
    .filter(e => isShoppingListEntry(e) && e.date >= cutoff && e.date <= today);
  if (lists.length === 0) return [];
  const latest = lists.reduce((max, e) => (e.date > max ? e.date : max), '');
  const names = new Map();
  for (const e of lists) {
    if (e.date !== latest) continue;
    for (const raw of e.extras || []) {
      const v = String(raw || '').trim();
      if (v && !names.has(v.toLowerCase())) names.set(v.toLowerCase(), v);
    }
  }
  return [...names.values()];
}

/**
 * Every saved shopping list, newest first, with its ingredients spelled out:
 * the recipes' ingredients (merged, a count of how many recipes use each) and
 * the added items. Recipes are read as they are NOW — the archive keeps ids,
 * not snapshots — and a deleted recipe is listed by its missing id.
 */
export function shoppingListWeeks(history, getRecipe) {
  const out = [];
  for (const e of Array.isArray(history) ? history : []) {
    if (!isShoppingListEntry(e)) continue;
    const recipes = [];
    const ingredients = new Map(); // lowercased name → { name, count }
    for (const id of e.recipeIds || []) {
      const r = typeof getRecipe === 'function' ? getRecipe(id) : null;
      if (!r) { recipes.push({ id, title: null }); continue; }
      recipes.push({ id, title: r.title || 'Untitled' });
      const seen = new Set();
      for (const ing of r.ingredients || []) {
        const name = String(ing?.ingredient || '').trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const cur = ingredients.get(key);
        if (cur) cur.count += 1;
        else ingredients.set(key, { name, count: 1 });
      }
    }
    const extras = [...new Set((e.extras || []).map(n => String(n || '').trim()).filter(Boolean))];
    out.push({
      date: e.date,
      timestamp: e.timestamp || e.date,
      recipes,
      ingredients: [...ingredients.values()].sort((a, b) => a.name.localeCompare(b.name)),
      extras,
    });
  }
  return out.sort((a, b) => (b.date === a.date ? String(b.timestamp).localeCompare(String(a.timestamp)) : b.date.localeCompare(a.date)));
}

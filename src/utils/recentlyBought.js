/**
 * The meals you have actually bought lately, for Design a Meal's picker.
 *
 * Read from planHistory (localStorage `sunday-plan-history`, Firestore
 * `planHistory`) — the archive Meal History shows. "Reset Shopping List"
 * appends { date, recipeIds } to it, so an entry is a shop that happened, and
 * its recipes are the meals that were bought for.
 */

export const PLAN_HISTORY_KEY = 'sunday-plan-history';

export function loadPlanHistory() {
  try {
    const raw = localStorage.getItem(PLAN_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Recipes from the most recent shops, newest first, each listed once with the
 * last date it was bought. Recipes that no longer exist (deleted since) are
 * skipped, as is anything `include` rejects. At most `limit` are returned.
 *
 * Returns [{ recipe, date, times }] — `times` is how many shops it was on.
 */
export function recentlyBoughtRecipes(history, recipes, { limit = 12, include } = {}) {
  const byId = new Map((recipes || []).filter(r => r && r.id).map(r => [r.id, r]));
  const found = new Map();
  for (const entry of Array.isArray(history) ? history : []) {
    const date = String(entry?.date || '');
    if (!date) continue;
    for (const id of new Set(entry.recipeIds || [])) {
      const recipe = byId.get(id);
      if (!recipe || (include && !include(recipe))) continue;
      const seen = found.get(id);
      if (!seen) found.set(id, { recipe, date, times: 1 });
      else {
        seen.times += 1;
        if (date > seen.date) seen.date = date;
      }
    }
  }
  return [...found.values()]
    .sort((a, b) => b.date.localeCompare(a.date) || String(a.recipe.title || '').localeCompare(String(b.recipe.title || '')))
    .slice(0, limit);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' (or an ISO timestamp) → "Oct 6"; '' when unreadable. */
export function formatBoughtDate(date) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : '';
}

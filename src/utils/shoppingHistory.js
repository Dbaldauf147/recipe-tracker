/* The shopping-list side of Meal History (`planHistory`).

   "Reset Shopping List" archives each week's list as { date, recipeIds,
   extras?, timestamp }; utils/shoppingListAutoSave.js saves the same shape
   with `source: 'auto-list'` when Reset is skipped — `extras` being the names of the hand-added items
   AND that week's auto-added snack and fruit. Entries the site fills in from
   the Week Plan (`source: 'week-plan'`, utils/autoWeekHistory.js) are meals
   that were eaten, not lists that were shopped, so they're left out here.

   Two consumers:
     • Meal History's "Shopping Lists" tab — shoppingListWeeks().
     • The weekly snack/fruit auto-add (findTopSince in pantryAutoAdd.js),
       which skips whatever was on the LAST list — lastShoppingListExtras() —
       so the same snack or fruit is never picked two weeks in a row.

   The mobile app mirrors lastShoppingListExtras in its pantryAutoAdd.ts. */

import { activeEntries } from './dailyTotals.js';
import { openAutoIndex } from './shoppingListAutoSave.js';

// The Sunday starting a Week Plan fill-in's week.
function weekOf(e) {
  if (e.weekStart) return e.weekStart;
  const [y, m, d] = String(e.date).split('-').map(Number);
  return addDaysKey(e.date, -new Date(y, m - 1, d).getDay());
}

// Days in [from, to] with a logged (not just suggested) meal of `recipeId`.
function loggedDayCount(dailyLog, recipeId, from, to) {
  let n = 0;
  for (const [day, rec] of Object.entries(dailyLog || {})) {
    if (day < from || day > to) continue;
    if (activeEntries(rec).some(en => en?.recipeId === recipeId && !en.autoSuggested)) n++;
  }
  return n;
}

/** A saved shopping list — by Reset, or auto-saved (not a Week Plan fill-in). */
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
  const all = Array.isArray(history) ? history : [];
  // This week's auto-saved list is the one being shopped from, not "last
  // week's" — counting it would swap this week's pick for another mid-week.
  const open = all[openAutoIndex(all, today)];
  const lists = all
    .filter(e => e !== open && isShoppingListEntry(e) && e.date >= cutoff && e.date <= today);
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
export function shoppingListWeeks(history, getRecipe, options = {}) {
  const { dailyLog = null, today = null } = options;
  const all = Array.isArray(history) ? history : [];
  const lists = all.filter(isShoppingListEntry);
  // A Week Plan fill-in stands in for a week that has NO saved list — those
  // weeks were shopped too, the list just never got saved. Its meals are the
  // ones logged that week; its added items are unknown.
  // Meals a saved list from that week (or the week before — bought ahead)
  // already holds are left off; a week with nothing left isn't shown.
  const rebuilt = [];
  for (const e of all) {
    if (!e || e.source !== 'week-plan' || !e.date) continue;
    const start = weekOf(e);
    const near = lists.filter(l => l.date >= addDaysKey(start, -6) && l.date <= addDaysKey(start, 6));
    const recipeIds = (e.recipeIds || []).filter(id => !near.some(l => (l.recipeIds || []).includes(id)));
    if (recipeIds.length) rebuilt.push({ ...e, recipeIds });
  }
  const listDates = lists.map(l => l.date).sort();
  const openEntry = today ? all[openAutoIndex(all, today)] : null;
  const out = [];
  for (const e of [...lists, ...rebuilt]) {
    const isRebuilt = e.source === 'week-plan';
    // The days this list fed: until the next saved list (two weeks at most).
    let windowEnd;
    if (isRebuilt) windowEnd = addDaysKey(weekOf(e), 6);
    else {
      const nextList = listDates.find(d => d > e.date);
      windowEnd = addDaysKey(e.date, 13);
      if (nextList && addDaysKey(nextList, -1) < windowEnd) windowEnd = addDaysKey(nextList, -1);
    }
    if (today && windowEnd > today) windowEnd = today;
    const recipes = [];
    const ingredients = new Map(); // lowercased name → { name, count }
    for (const id of e.recipeIds || []) {
      const r = typeof getRecipe === 'function' ? getRecipe(id) : null;
      const logged = dailyLog ? loggedDayCount(dailyLog, id, e.date, windowEnd) : null;
      if (!r) { recipes.push({ id, title: null, logged }); continue; }
      recipes.push({ id, title: r.title || 'Untitled', logged });
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
      kind: isRebuilt ? 'rebuilt' : e.source === 'auto-list' ? 'auto' : 'reset',
      current: !!openEntry && e === openEntry,
    });
  }
  return out.sort((a, b) => (b.date === a.date ? String(b.timestamp).localeCompare(String(a.timestamp)) : b.date.localeCompare(a.date)));
}

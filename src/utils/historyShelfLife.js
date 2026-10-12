// Meal History "use-by" list: every ingredient in a history week, how many
// days it should last, and the date that lands on counted from the week's
// prep date.
//
// Days come from, in order: what you typed for that week (entry.shelfLife,
// keyed by lowercased ingredient name), your ingredient database's
// minShelf/maxShelf when the recipe stores it the same way the database does,
// then the built-in shelf-life guide (fridge / freezer / pantry). The shorter
// end of a range wins — this is a use-by, so it errs early.

import { getShelfLifeDays } from './detectCuisine.js';

const STORAGE_KEYS = ['Fridge', 'Freezer', 'Pantry', 'Counter'];

/** 'Fridge' | 'Freezer' | 'Pantry' | 'Counter' | '' from free text like "Refrigerator". */
export function normalizeStorage(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return '';
  if (s.includes('freez')) return 'Freezer';
  if (s.includes('fridge') || s.includes('refrig')) return 'Fridge';
  if (s.includes('pantry') || s.includes('cupboard')) return 'Pantry';
  if (s.includes('counter')) return 'Counter';
  return STORAGE_KEYS.find(k => k.toLowerCase() === s) || '';
}

/** Deduped ingredients across a week's recipes, in first-seen order. */
export function weekIngredients(recipeIds, getRecipe) {
  const byKey = new Map();
  for (const id of recipeIds || []) {
    const recipe = getRecipe ? getRecipe(id) : null;
    if (!recipe) continue;
    for (const row of recipe.ingredients || []) {
      const name = String(row?.ingredient || '').trim();
      const key = name.toLowerCase();
      if (!key) continue;
      let item = byKey.get(key);
      if (!item) {
        item = { key, name, recipes: [], storage: '' };
        byKey.set(key, item);
      }
      if (recipe.title && !item.recipes.includes(recipe.title)) item.recipes.push(recipe.title);
      if (!item.storage) item.storage = normalizeStorage(row.storage);
    }
  }
  return [...byKey.values()];
}

const posInt = v => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Default days for one ingredient (no per-week override).
 * `dbRow` is the ingredient-database row for it, or null.
 * Returns { days, storage, source: 'db' | 'guide' } or null when unknown.
 */
export function defaultShelfDays(name, storage, dbRow) {
  const dbStorage = normalizeStorage(dbRow?.storage);
  const where = storage || dbStorage || 'Fridge';
  const dbMin = posInt(dbRow?.minShelf);
  const dbMax = posInt(dbRow?.maxShelf);
  if ((dbMin || dbMax) && (!storage || !dbStorage || storage === dbStorage)) {
    return { days: dbMin || dbMax, storage: where, source: 'db' };
  }
  const guide = getShelfLifeDays(name);
  if (guide) {
    const days = where === 'Freezer' ? guide.freezer
      : where === 'Pantry' || where === 'Counter' ? guide.pantry
      : guide.fridge;
    if (days != null && days > 0) return { days, storage: where, source: 'guide' };
  }
  return null;
}

/** 'YYYY-MM-DD' + n days (local calendar, DST-safe). */
export function addDaysKey(dateKey, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from `today` to `expiry` (negative once it has passed). */
export function daysUntil(expiry, today) {
  const p = k => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ''); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null; };
  const a = p(today), b = p(expiry);
  if (!a || !b) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * The use-by rows for one history entry, soonest expiry first (unknown last).
 * `lookupDbRow(name)` returns the ingredient-database row or null.
 */
export function buildUseByRows(entry, getRecipe, lookupDbRow, today) {
  const overrides = (entry && entry.shelfLife && typeof entry.shelfLife === 'object') ? entry.shelfLife : {};
  const start = entry?.weekStart || entry?.date || '';
  const rows = weekIngredients(entry?.recipeIds, getRecipe).map(item => {
    const dflt = defaultShelfDays(item.name, item.storage, lookupDbRow ? lookupDbRow(item.name) : null);
    const own = posInt(overrides[item.key]);
    const days = own || dflt?.days || 0;
    const expires = days ? addDaysKey(start, days) : '';
    return {
      ...item,
      storage: item.storage || dflt?.storage || '',
      days,
      defaultDays: dflt?.days || 0,
      source: own ? 'you' : (dflt?.source || ''),
      expires,
      left: expires ? daysUntil(expires, today) : null,
    };
  });
  return rows.sort((a, b) => {
    if (!a.expires !== !b.expires) return a.expires ? -1 : 1;
    return a.expires.localeCompare(b.expires) || a.name.localeCompare(b.name);
  });
}

/** entry.shelfLife with one ingredient set (positive days) or cleared (blank / 0 / matches default). */
export function withShelfOverride(shelfLife, key, value, defaultDays) {
  const next = { ...(shelfLife && typeof shelfLife === 'object' ? shelfLife : {}) };
  const n = posInt(value);
  if (!n || n === defaultDays) delete next[key];
  else next[key] = n;
  return next;
}

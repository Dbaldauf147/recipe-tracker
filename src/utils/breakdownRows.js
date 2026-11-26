// Helpers for the nutrition panel's per-ingredient breakdown table, where each
// ingredient name can be clicked to rename it and see what it contributes.
//
// Pure on purpose (no store, no network) so it runs under `node --test`.

import { suggestIngredientNames, normalizeIngredientName } from './ingredientNameSuggest.js';

const norm = (s) => (s || '').trim().toLowerCase();

/**
 * Recipe rows the nutrition lookup returned nothing for. The lookup drops
 * those rows entirely, so without this they never appear in the breakdown and
 * there is nothing to click to fix the name.
 *
 * `items` carry `matchedTo` — the recipe's own ingredient text — so this
 * matches on that rather than on position (a dropped row shifts every index
 * after it).
 */
export function unmatchedIngredients(items, ingredients) {
  const found = new Set((items || []).map(it => norm(it?.matchedTo)));
  const seen = new Set();
  const out = [];
  for (const row of ingredients || []) {
    const key = norm(row?.ingredient);
    if (!key || found.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * Names from the user's ingredient list to offer in place of `name`. Starts
 * strict; when nothing clears that bar — which is exactly the "not found" /
 * wrong-match case — it relaxes once so there is still something to pick,
 * rather than an empty box.
 */
export function breakdownNameSuggestions(name, dbNames, limit = 5) {
  const list = dbNames || [];
  const strict = suggestIngredientNames(name, list, limit);
  if (strict.length > 0) return strict;
  const loose = suggestIngredientNames(name, list, limit, 0.4);
  // Recipe text is often wordier than the list's name: "beef or chicken bone
  // broth" → "bone broth", "parmesan cheese, grated" → "parmesan cheese". The
  // spelling score sinks on the extra words, so offer any list name whose
  // words all appear in the recipe's, longest (most specific) first.
  const words = new Set(normalizeIngredientName(name).split(' ').filter(Boolean));
  const self = norm(name);
  const contained = words.size === 0 ? [] : list
    .map(n => (n || '').trim())
    .filter(n => {
      if (!n || norm(n) === self) return false;
      const nw = normalizeIngredientName(n).split(' ').filter(Boolean);
      return nw.length > 0 && nw.every(w => words.has(w));
    })
    .sort((a, b) => normalizeIngredientName(b).split(' ').length - normalizeIngredientName(a).split(' ').length || a.length - b.length);
  const out = [];
  const seen = new Set();
  for (const n of [...loose, ...contained]) {
    const k = norm(n);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(n);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Index into the recipe's full ingredient list (blank rows included) of the
 * row whose text is `name` — what the editor needs to rename it in place.
 * -1 when it is gone (edited since the lookup ran).
 */
export function ingredientIndexByName(ingredients, name) {
  const target = (name || '').trim();
  if (!target) return -1;
  const list = ingredients || [];
  const exact = list.findIndex(row => (row?.ingredient || '').trim() === target);
  if (exact !== -1) return exact;
  return list.findIndex(row => norm(row?.ingredient) === norm(target));
}

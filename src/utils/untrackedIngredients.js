// Which ingredients in a recipe being imported aren't tracked for nutrition —
// i.e. nothing in My Ingredients matches them — and what to offer as a match.
//
// "Tracked" asks the same question the nutrition lookup does: sheetMatch's
// findMatch over your ingredient names, minus the far-off hits matchStrength
// calls 'weak' ("salt" → "butter_salted"), which the breakdown already warns
// about as wrong. A partial hit ("red onion" → "onion") counts as tracked.
//
// Pure: the form passes in your ingredient names.

import { findMatch, matchStrength, nameWords } from './sheetMatch.js';
import { ingredientMatchScore } from './ingredientMatch.js';

export function isTracked(name, myNames) {
  const n = String(name || '').trim();
  if (!n) return true;
  const hit = findMatch(myNames.map(x => ({ name: x })), n);
  return !!hit && matchStrength(n, hit.name) !== 'weak';
}

/** Row indexes of the recipe's ingredients that aren't tracked. Nothing is
 *  flagged before your ingredient list has loaded — every row would be. */
export function untrackedRows(ingredients, myNames) {
  if (!myNames || myNames.length === 0) return [];
  const out = [];
  (ingredients || []).forEach((row, i) => {
    const name = String(row?.ingredient || '').trim();
    if (name && !isTracked(name, myNames)) out.push(i);
  });
  return out;
}

/**
 * Your ingredients to offer as the match for `name`, best first. With a typed
 * `query`, it's the usual picker ranking; without one, the names sharing the
 * most words with the recipe's ("fresh cilantro, chopped" → "cilantro").
 */
export function matchCandidates(name, myNames, query = '', limit = 6) {
  const q = query.trim();
  if (q) {
    return myNames
      .map((n, idx) => ({ n, idx, score: ingredientMatchScore(n, q) }))
      .filter(s => s.score < 5)
      .sort((a, b) => a.score - b.score || a.n.length - b.n.length || a.idx - b.idx)
      .slice(0, limit)
      .map(s => s.n);
  }
  const want = new Set(nameWords(name));
  return myNames
    .map((n, idx) => ({ n, idx, shared: nameWords(n).filter(w => want.has(w)).length }))
    .filter(s => s.shared > 0)
    .sort((a, b) => b.shared - a.shared || a.n.length - b.n.length || a.idx - b.idx)
    .slice(0, limit)
    .map(s => s.n);
}

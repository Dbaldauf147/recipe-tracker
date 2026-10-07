// "Did you mean…" for a recipe ingredient's name — the closest names in the
// user's ingredient list, by spelling.
//
// Used by Cook Mode's rename popup: "tomatos" → "tomato", "parmesan chese" →
// "parmesan cheese". A recipe line links to its ingredient-DB row by
// lowercased name (see getDbGrams in RecipeDetail), so fixing the spelling
// to an existing name is also what makes the line pick up that row's macros.
//
// Mirrors the mobile app's src/utils/ingredientNameSuggest.ts — keep the two in step.

function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 4 && /(oes|ches|shes|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Lowercase, punctuation out, words singular — "Tomatoes," → "tomato". */
export function normalizeIngredientName(name) {
  return (name || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular)
    .join(' ');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0..1 — how alike two names are once normalized. 1 = same food. */
export function nameSimilarity(a, b) {
  const na = normalizeIngredientName(a);
  const nb = normalizeIngredientName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const spelling = 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
  // Same words in a different order ("cheese, parmesan" vs "parmesan cheese")
  // reads as a near-match even though the letters line up badly.
  const wa = new Set(na.split(' '));
  const wb = new Set(nb.split(' '));
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  const words = shared / Math.max(wa.size, wb.size);
  return Math.max(spelling, words * 0.95);
}

/**
 * Up to `limit` names from `candidates` that look like `name`, best first.
 * The name itself (ignoring case/whitespace) is never suggested, and weak
 * matches are dropped rather than padded out — no suggestion beats a wrong one.
 */
export function suggestIngredientNames(
  name,
  candidates,
  limit = 3,
  minScore = 0.6,
) {
  const self = (name || '').toLowerCase().trim();
  if (!self) return [];
  const seen = new Set();
  const scored = [];
  for (const c of candidates) {
    const trimmed = (c || '').trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || key === self || seen.has(key)) continue;
    seen.add(key);
    const score = nameSimilarity(name, trimmed);
    if (score >= minScore) scored.push({ name: trimmed, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
    .slice(0, limit)
    .map(s => s.name);
}

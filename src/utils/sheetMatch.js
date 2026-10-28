// How well a nutrition lookup's matched food fits the ingredient the recipe
// actually asked for. The lookups (your sheet, USDA, …) return their best
// guess, and a guess can be far off — "pumpkin pie spice" once matched the
// sheet row "ice", and "salt" matched "butter_salted". The breakdown table
// uses this to warn on those rows.
//
//   'good'    — every word you wrote is in the matched name
//   'partial' — some of them are ("pumpkin puree" → "pumpkin, raw")
//   'weak'    — none are: almost certainly the wrong food

// Words that describe a food's state or where it came from, not what it is —
// they shouldn't count for or against a match.
const FILLER = new Set([
  'raw', 'fresh', 'organic', 'from', 'your', 'sheet', 'and', 'or', 'with', 'of',
  'the', 'a', 'plain', 'whole', 'ground', 'dried', 'chopped', 'sliced', 'diced',
  'minced', 'cooked', 'uncooked', 'frozen', 'canned', 'large', 'medium', 'small',
]);

function singular(w) {
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es') && /(ch|sh|x|o)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** Lowercase whole words, singular, `_`/punctuation as separators. */
export function nameWords(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\(from your sheet\)/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);
}

function meaningful(words) {
  const kept = words.filter(w => !FILLER.has(w));
  return kept.length ? kept : words;
}

/**
 * Does `needle` appear in `hay` as whole words, in order? "salt" is in
 * "sea salt" but not in "butter_salted"; "ice" is not in "pumpkin pie spice".
 */
export function containsWords(hay, needle) {
  const h = nameWords(hay);
  const n = nameWords(needle);
  if (!n.length || n.length > h.length) return false;
  for (let i = 0; i + n.length <= h.length; i++) {
    if (n.every((w, j) => h[i + j] === w)) return true;
  }
  return false;
}

// The sheet row (`{ name }`) that best matches an ingredient name, or null.
// Used by sheetNutrition's lookupFromSheet. Past the exact
// match, every rule compares WHOLE words — plain substrings matched
// "pumpkin pie spice" to the row "ice" and "salt" to "butter_salted", and a
// wrong sheet row also stops the USDA lookup that would have found the
// right food.
function startsWithWords(a, b) {
  const wa = nameWords(a), wb = nameWords(b);
  return wb.length > 0 && wb.length <= wa.length && wb.every((w, i) => wa[i] === w);
}

export function findMatch(rows, ingredientName) {
  const search = ingredientName.trim().toLowerCase();

  // 1. Exact match
  const exact = rows.find(r => r.name.toLowerCase() === search);
  if (exact) return exact;

  // 2. Sheet name starts with search or search starts with sheet name
  const partial = rows.find(r => startsWithWords(r.name, search) || startsWithWords(search, r.name));
  if (partial) return partial;

  // 3. Search words all appear in sheet name
  const searchWords = nameWords(search);
  const wordMatch = searchWords.length > 0 && rows.find(r => {
    const rn = new Set(nameWords(r.name));
    return searchWords.every(w => rn.has(w));
  });
  if (wordMatch) return wordMatch;

  // 4. Any sheet name is contained in the search or vice versa
  const contains = rows.find(r => containsWords(r.name, search) || containsWords(search, r.name));
  if (contains) return contains;

  return null;
}

/** 'good' | 'partial' | 'weak' — see the top of the file. */
export function matchStrength(wanted, matched) {
  const want = meaningful(nameWords(wanted));
  const got = new Set(nameWords(matched));
  if (!want.length) return 'good';
  const hits = want.filter(w => got.has(w)).length;
  if (hits === want.length) return 'good';
  return hits > 0 ? 'partial' : 'weak';
}

// What a recipe's ingredient line should probably be called, for the shopping
// list's "Name in your meals" field.
//
// Recipe lines drift from the ingredient DB ("2 large ripe bananas, sliced"
// vs "Bananas"), and a name the DB doesn't know gets no unit weights, no
// section and no merging with the same food from another meal. The
// suggestion is the closest DB name, else the line with the cooking notes
// stripped off.
//
// Mirrors the mobile app's src/utils/suggestIngredientName.ts (and the slice
// of its ingredientMatchScore that the suggestion relies on) — keep the two
// in step. The web's own ingredientMatch.js is the simpler picker ranking and
// is deliberately left alone here.

/** "banana" vs "bananas" / "tomato" vs "tomatoes" — a single trailing s/es. */
function samePlural(a, b) {
  return a === b || a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a;
}

function words(s) {
  return s.toLowerCase().split(/[^a-z0-9%]+/).filter(Boolean);
}

/** Same words, any order, plural-aware: "Rice, brown" = "brown rice". */
function sameWords(a, b) {
  if (a.length !== b.length || a.length === 0) return false;
  const pool = [...b];
  for (const w of a) {
    const i = pool.findIndex(p => samePlural(p, w));
    if (i < 0) return false;
    pool.splice(i, 1);
  }
  return true;
}

// Preparation-state words that don't change WHAT the food is.
const PREP_WORDS = new Set([
  'cooked', 'uncooked', 'raw', 'dry', 'dried', 'plain', 'steamed', 'boiled', 'fresh', 'prepared',
]);

/** The name's head before a qualifier: "Rice (cooked)" → "rice". */
function headSegment(n) {
  return n.split(/,|\(|\[|:| [-–—] /)[0];
}

/** Lower = better; same scale as mobile's ingredientMatchScore (0 exact … 5 no match). */
function matchScore(name, q) {
  const query = (q || '').toLowerCase().trim();
  if (!query) return 5;
  const qWords = words(query);
  const n = (name || '').toLowerCase().trim();
  if (!n) return 5;
  if (samePlural(n, query)) return 0;
  const nWords = words(n);
  if (sameWords(qWords, nWords)) return 0.25;
  const segs = n.split(',');
  const lead = [];
  for (let k = 0; k < segs.length - 1; k++) {
    lead.push(...words(segs[k]));
    if (lead.length > qWords.length) break;
    if (sameWords(qWords, lead)) return 0.5;
  }
  if (sameWords(qWords, words(headSegment(n)))) return 0.5;
  const core = nWords.filter(w => !PREP_WORDS.has(w));
  if (core.length < nWords.length && sameWords(qWords, core)) return 0.5;
  if (n.startsWith(query + ' ')) return 1;
  if (n.startsWith(query)) return 2;
  if (n.includes(' ' + query + ' ') || n.endsWith(' ' + query)) return 3;
  if (qWords.length > 1 && qWords.every(qw => nWords.some(w => samePlural(w, qw)))) return 3.5;
  if (n.includes(query)) return 4;
  return 5;
}

// Size, ripeness and knife-work words that describe the portion or the prep,
// not the thing you buy. "Red", "green", "brown" etc. DO change what you buy,
// so they are not here.
const DESCRIPTOR_WORDS = new Set([
  'large', 'medium', 'small', 'big', 'extra', 'ripe', 'fresh', 'freshly',
  'chopped', 'diced', 'minced', 'sliced', 'thinly', 'finely', 'roughly',
  'grated', 'shredded', 'crushed', 'peeled', 'halved', 'quartered', 'cubed',
  'trimmed', 'rinsed', 'drained', 'packed', 'heaping', 'about', 'optional',
  'to', 'taste', 'for', 'serving', 'garnish', 'divided', 'softened', 'melted',
  'room', 'temperature', 'cold', 'warm', 'whole', 'of',
]);

/** Strip quantities, parentheticals, trailing ", chopped" notes and descriptor words. */
export function cleanIngredientName(raw) {
  let s = (raw || '').trim();
  s = s.replace(/\([^)]*\)/g, ' ');           // "(about 2 cups)"
  s = s.split(/,| - | – | — /)[0];             // "onion, diced" → "onion"
  s = s.replace(/^[\d\s./½¼¾⅓⅔-]+/, ' ');     // leading "2 ", "1/2 "
  // ...and the unit after it: "cup walnuts" → "walnuts".
  s = s.replace(/^\s*(cups?|tbsps?|tsps?|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|cans?|pinch|dash)\b\.?\s*/i, '');
  const kept = s.split(/\s+/).filter(w => w && !DESCRIPTOR_WORDS.has(w.toLowerCase()));
  const out = kept.join(' ').trim();
  return out ? out.charAt(0).toUpperCase() + out.slice(1) : '';
}

/**
 * WHAT the food is — the noun the rest of the name describes. "Brown rice",
 * "Rice, white, cooked" and "Basmati rice (dry)" are all rice; "Rice vinegar"
 * is vinegar and "Rice noodles" are noodles. English puts that noun last,
 * except in DB-style names where it leads before the comma.
 */
export function headNoun(name) {
  const seg = (name || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').split(/,| [-–—] /)[0];
  const ws = words(seg).filter(w => !PREP_WORDS.has(w));
  return ws[ws.length - 1] || '';
}

/**
 * Names from `dbNames` worth offering for `name`, best first, at most `limit`.
 * Only the SAME KIND of ingredient is offered: "rice" brings up brown, jasmine
 * and white rice, never rice vinegar or rice noodles, however alike they
 * spell. With no DB name of that kind it falls back to the cleaned-up line.
 * `name` itself is never in the list.
 */
export function suggestIngredientNames(name, dbNames, limit = 8) {
  const current = (name || '').trim();
  if (!current) return [];
  const lower = current.toLowerCase();
  const cleaned = cleanIngredientName(current);
  const head = headNoun(cleaned || current);

  const best = new Map(); // lowercased name → { name, score }
  for (const n of dbNames) {
    const trimmed = (n || '').trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || key === lower || !head || !samePlural(headNoun(trimmed), head)) continue;
    // Closest to the cleaned line first ("jasmine rice" → "Jasmine rice" before
    // "Brown rice"); every one of them is the right kind of food.
    const score = Math.min(matchScore(trimmed, cleaned || current), matchScore(trimmed, current));
    const prev = best.get(key);
    if (!prev || score < prev.score) best.set(key, { name: trimmed, score });
  }
  const out = [...best.values()]
    .sort((a, b) => a.score - b.score || a.name.length - b.name.length || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(x => x.name);
  if (out.length === 0 && cleaned && cleaned.toLowerCase() !== lower) out.push(cleaned);
  return out;
}

/**
 * Suggested name for `name`, or null when it already reads right (it is a DB
 * name, or there is nothing better to offer).
 */
export function suggestIngredientName(name, dbNames) {
  const current = (name || '').trim();
  if (!current) return null;
  const lower = current.toLowerCase();
  if (dbNames.some(n => (n || '').toLowerCase().trim() === lower)) return null;
  return suggestIngredientNames(current, dbNames, 1)[0] || null;
}

/**
 * Rename every line called `oldName` (case-insensitive) in `ingredients` to
 * `newName`. Returns the new array, or null when no line matched.
 */
export function renameIngredientLines(ingredients, oldName, newName) {
  const key = (oldName || '').toLowerCase().trim();
  const to = (newName || '').trim();
  if (!key || !to || !Array.isArray(ingredients)) return null;
  let hit = false;
  const next = ingredients.map(ing => {
    if ((ing?.ingredient || '').toLowerCase().trim() !== key || ing.ingredient === to) return ing;
    hit = true;
    return { ...ing, ingredient: to };
  });
  return hit ? next : null;
}

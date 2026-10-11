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
 * Suggested name for `name`, or null when it already reads right (it is a DB
 * name, or there is nothing better to offer).
 */
export function suggestIngredientName(name, dbNames) {
  const current = (name || '').trim();
  if (!current) return null;
  const lower = current.toLowerCase();
  if (dbNames.some(n => (n || '').toLowerCase().trim() === lower)) return null;

  const cleaned = cleanIngredientName(current);
  let best = null;
  for (const queryName of new Set([cleaned, current].filter(Boolean))) {
    for (const n of dbNames) {
      if (!n) continue;
      const score = matchScore(n, queryName);
      // Up to "every word, any order" — past that it is a guess, not a match.
      if (score > 3.5) continue;
      if (!best || score < best.score || (score === best.score && n.length < best.name.length)) {
        best = { name: n.trim(), score };
      }
    }
  }
  const pick = best?.name || cleaned;
  return pick && pick.toLowerCase() !== lower ? pick : null;
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
    if ((ing?.ingredient || '').toLowerCase().trim() !== key) return ing;
    hit = true;
    return { ...ing, ingredient: to };
  });
  return hit ? next : null;
}

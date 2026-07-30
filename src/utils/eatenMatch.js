// Matching a tracked pantry/snack/fruit item against the ingredients of the
// meals in the daily log — the "Since" (days since last eaten) column on the
// Shopping List page's tracked-item widgets.
//
// This used to be a bidirectional substring test with a 4-character floor, and
// it read almost everything as eaten today: "hummus_garlic" matched any recipe
// with GARLIC in it, "rice cake(s)_white cheddar" matched RICE, "sweet
// potato(s)" matched POTATO, "apple(s)_honey crisp" matched HONEY, "pineapple"
// matched APPLE, and "watermelon" matched MELON. A Since column that says 0 for
// food you didn't eat is worse than no column, so matching is now by WORDS.
//
// The rule leans on the naming convention these lists already use — a food, an
// underscore, then which one: `hummus_garlic`, `rice cake(s)_white cheddar`,
// `apple(s)_honey crisp`, `olive(s)_pitted black`. The part before the
// underscore is the food (the BASE); the rest narrows it down. A logged
// ingredient counts as this item when it:
//
//   • contains every word of the base — so "rice" alone is not "rice cakes",
//     and "garlic" alone is not "hummus"; and
//   • adds no word the item doesn't have — so "sweet potato" is not "potato",
//     and generic "peppers" is not "shishito peppers".
//
// which lets the qualifier sit on either side: tracked `olive(s)_pitted black`
// matches a logged "black olives", and tracked `grapes_red` matches both a
// logged "grapes" and a logged "red grapes".
//
// The trade is recall: an ingredient written more loosely than the tracked name
// ("kimchi, spicy") no longer matches, so Since reads higher than it might.
// That's the safe direction to be wrong in — and one click on the row resets it.

// Plural → singular, enough for food names. Deliberately crude: this only ever
// compares one food name to another, so over-stemming a word is harmless as
// long as it's over-stemmed identically on both sides.
function singular(w) {
  if (w.length > 3 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && /(ch|sh|ss|x|z)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/**
 * A food name as a set of comparable words: lowercased, "(s)" dropped,
 * punctuation and separators flattened to spaces, each word singularized.
 * @param {string} name
 * @returns {string[]} unique words, sorted so word order never matters
 */
export function foodWords(name) {
  const words = String(name || '')
    .toLowerCase()
    .replace(/\(s\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(singular);
  return [...new Set(words)].sort();
}

/**
 * The map key for a logged ingredient name. Word-set based, so "red grapes" and
 * "grapes red" land on the same key.
 */
export function eatenKey(name) {
  return foodWords(name).join(' ');
}

/**
 * Split a tracked item's name into the food itself and the food-plus-qualifier,
 * on the `base_variant` convention. No underscore → the two are the same.
 * @returns {{ base: string[], full: string[] }}
 */
export function trackedNameParts(name) {
  const raw = String(name || '');
  const cut = raw.indexOf('_');
  return {
    base: foodWords(cut >= 0 ? raw.slice(0, cut) : raw),
    full: foodWords(raw.replace(/_/g, ' ')),
  };
}

const subset = (a, b) => a.every(w => b.includes(w));

/**
 * The most recent date a tracked item was eaten, or null.
 * @param {string} trackedName the item's name as it appears in the widget
 * @param {Map<string,string>} eatenMap eatenKey(ingredient) → ISO/date string
 * @returns {string|null}
 */
export function lookupEatenDate(trackedName, eatenMap) {
  if (!eatenMap || typeof eatenMap.get !== 'function') return null;
  const { base, full } = trackedNameParts(trackedName);
  if (base.length === 0) return null;
  let best = null;
  for (const [key, date] of eatenMap) {
    if (!date) continue;
    const logged = key ? key.split(' ') : [];
    if (logged.length === 0) continue;
    // Has the whole food, and nothing this item isn't.
    if (!subset(base, logged) || !subset(logged, full)) continue;
    if (!best || date > best) best = date;
  }
  return best;
}

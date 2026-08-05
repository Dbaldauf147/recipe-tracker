// Matching air fryer guide rows to the ingredients in your recipes.
//
// The guide is written the way you'd say a thing out loud — "Chicken breast
// (boneless)", "Spring rolls / egg rolls (frozen)" — while recipe ingredients
// are written the way they appear on a shopping list: pluralised, qualified,
// in whatever order the source wrote them. So the match is a heuristic, and it
// is deliberately a CONSERVATIVE one: a row with no recipes against it is a
// small missed opportunity, but a row claiming a recipe it isn't in sends you
// to the wrong page while you're holding food.
//
// The rules:
//   - parentheticals are stripped ("(boneless)" is a qualifier, not the thing)
//   - a slash means alternatives, so each side is tried separately
//   - both sides are crudely singularised, so "chicken breasts" finds
//     "Chicken breast"
//   - the term must appear as WHOLE WORDS. Substring matching would file
//     "toasted sesame oil" under "Toast" and "nutmeg" under "Nuts".

/** Lowercase, drop parentheticals and punctuation, collapse whitespace. */
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Crude singular form of one word.
 *
 * No stemmer — this only has to survive kitchen plurals, and a real one starts
 * mangling food words. The cases that matter here:
 *   asparagus, couscous, glass  stay put (already singular, or -ss)
 *   potatoes, peaches           lose the whole "es", not just the "s"
 *   berries                     become berry
 *   breasts, wings, rolls       lose the "s"
 *
 * Getting "potatoes" wrong is not cosmetic: both sides are singularised with
 * this same function, so a term that stems to "potatoe" silently fails to match
 * a recipe that wrote "potato".
 */
function singularWord(w) {
  if (w.length <= 3) return w;
  if (/(ss|us)$/.test(w)) return w;
  if (/(oes|ches|shes|xes|sses)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith('ies') && w.length > 4) return `${w.slice(0, -3)}y`;
  if (w.endsWith('s')) return w.slice(0, -1);
  return w;
}

function singularize(phrase) {
  return phrase.split(' ').map(singularWord).join(' ');
}

/**
 * The searchable terms for one guide row name.
 *
 * "Spring rolls / egg rolls (frozen)" → ["spring roll", "egg roll"]
 */
export function guideTerms(guideName) {
  return normalize(guideName)
    .split('/')
    .map(part => singularize(part.trim()))
    .filter(term => term.length >= 3);
}

/** Does a recipe's ingredient name contain any of these terms, whole-word? */
export function ingredientMatchesTerms(ingredientName, terms) {
  const hay = ` ${singularize(normalize(ingredientName))} `;
  return terms.some(term => hay.includes(` ${term} `));
}

/**
 * Which of your recipes use each guide row, and which of those are on this
 * week's plan.
 *
 * `weekIds` is the set of recipe ids in the weekly plan — the recipes whose
 * ingredients make up this week's shopping list. Returns a plain object keyed
 * by the guide row's lowercased name, so the page can look a row up directly.
 */
export function indexRecipesByGuide(guideRows, recipes = [], weekIds = new Set(), links = {}) {
  const week = weekIds instanceof Set ? weekIds : new Set(weekIds || []);
  const index = {};

  // Terms are derived once per guide row, not once per (row × recipe) pair —
  // this runs over the whole library on every render of the page.
  const rowTerms = guideRows.map(row => {
    const key = String(row?.name || '').trim().toLowerCase();
    // A linked database ingredient ADDS a term rather than replacing the ones
    // from the row's name. The link is there to catch what the name-based guess
    // misses ("Chicken breast (boneless)" → your "chicken cutlets"), and
    // dropping the original terms would trade one set of misses for another.
    const linked = links?.[key];
    const terms = linked ? [...guideTerms(row?.name), ...guideTerms(linked)] : guideTerms(row?.name);
    return { key, terms: [...new Set(terms)] };
  });

  for (const { key } of rowTerms) {
    if (!key) continue;
    index[key] = { recipes: [], weekRecipes: [] };
  }

  for (const recipe of recipes || []) {
    const names = (recipe?.ingredients || [])
      .map(ing => (ing?.ingredient || '').trim())
      .filter(Boolean);
    if (names.length === 0) continue;
    const inWeek = week.has(recipe.id);

    for (const { key, terms } of rowTerms) {
      if (!index[key] || terms.length === 0) continue;
      if (!names.some(n => ingredientMatchesTerms(n, terms))) continue;
      const entry = { id: recipe.id, title: recipe.title || 'Untitled' };
      index[key].recipes.push(entry);
      if (inWeek) index[key].weekRecipes.push(entry);
    }
  }

  for (const key of Object.keys(index)) {
    index[key].recipes.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
    index[key].weekRecipes.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
  }
  return index;
}

// Matching air fryer guide rows to the ingredients in your recipes.
//
// Two jobs live here. indexRecipesByGuide answers "which of my recipes use this
// row"; rankIngredientsForGuide answers "which of my DATABASE ingredients IS
// this row", which is what the link picker predicts from.
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

// Extension included on purpose: these utils run under `node --test` as well as
// Vite, and the node ESM resolver won't guess it.
import { ingredientMatchScore } from './ingredientMatch.js';

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
 * Your database ingredients that look like they ARE this guide row, best first.
 * Returns [{ name, score }], score being ingredientMatchScore's (0 = exact).
 *
 * Scored in BOTH directions, which is the whole trick. Neither side is reliably
 * the longer phrase: the guide says "Broccoli florets" where your database says
 * "Broccoli", and "Chicken breast" where yours says "Chicken breasts, boneless".
 * Scoring one way only would miss whichever half of that you happen to have.
 *
 * Both sides arrive normalized and singularised (guideTerms does it to the row,
 * we do it to your name here), so "Potatoes" and "potato" meet in the middle
 * rather than failing on a plural.
 */
export function rankIngredientsForGuide(guideName, dbNames = []) {
  const terms = guideTerms(guideName);
  if (terms.length === 0) return [];
  const out = [];
  for (const raw of dbNames) {
    const name = String(raw || '').trim();
    if (!name) continue;
    const mine = singularize(normalize(name));
    if (!mine) continue;
    let best = 5;
    for (const term of terms) {
      best = Math.min(best, ingredientMatchScore(mine, term), ingredientMatchScore(term, mine));
      if (best === 0) break;
    }
    if (best >= 5) continue; // nothing in common at all
    out.push({ name, score: best });
  }
  return out.sort((a, b) => a.score - b.score
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * The best score still worth offering as a one-tap "use this" — exact, or one
 * name being the start of the other. Anything looser (a shared whole word, a
 * substring) still RANKS in the picker but has to be chosen deliberately.
 *
 * Same conservatism as the recipe matching above, for the same reason: a wrong
 * suggestion you accepted without reading is worse than no suggestion, because
 * it silently renames the row to something it isn't.
 */
export const CONFIDENT_MATCH_SCORE = 2;

/** The one suggestion confident enough to offer as a single tap, or ''. */
export function bestIngredientForGuide(guideName, dbNames = []) {
  const [top] = rankIngredientsForGuide(guideName, dbNames);
  return top && top.score <= CONFIDENT_MATCH_SCORE ? top.name : '';
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

/**
 * Which of the shopping list's NON-RECIPE items each guide row matches.
 *
 * The "In this week's shopping list" group was built only from recipes on the
 * week's plan, so a snack you added straight to the list — venison sticks,
 * brussel sprouts, a bag of fries — sat down in "Everything else" even though
 * it is, literally, in this week's shopping list. Those items belong to no
 * recipe, so no amount of recipe indexing was ever going to find them.
 *
 * `extras` is the shopping list's manual side (user doc `shopExtras`, plus the
 * auto-injected top snack and fruit): items shaped { ingredient, source }.
 * Matching reuses the same terms as the recipe index, so a row's ingredient
 * link works here too.
 *
 * Returns { [rowKey]: string[] } — the matching ingredient labels, for a row to
 * show WHY it's flagged.
 */
export function indexExtrasByGuide(guideRows, extras = [], links = {}) {
  const index = {};
  const rowTerms = (guideRows || []).map(row => {
    const key = String(row?.name || '').trim().toLowerCase();
    const linked = links?.[key];
    const terms = linked ? [...guideTerms(row?.name), ...guideTerms(linked)] : guideTerms(row?.name);
    return { key, terms: [...new Set(terms)] };
  });
  for (const { key } of rowTerms) if (key) index[key] = [];

  for (const item of extras || []) {
    const name = String(item?.ingredient || '').trim();
    if (!name) continue;
    for (const { key, terms } of rowTerms) {
      if (!index[key] || terms.length === 0) continue;
      if (!ingredientMatchesTerms(name, terms)) continue;
      if (!index[key].includes(name)) index[key].push(name);
    }
  }
  for (const key of Object.keys(index)) {
    index[key].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }
  return index;
}

/**
 * The guide row for one ingredient, or null — the reverse of the lookups above,
 * which all go row → ingredients.
 *
 * Same conservative whole-word matching, for the same reason: this drops
 * cooking instructions into a recipe, and a wrong row tells you to cook fish at
 * chicken temperatures.
 *
 * Where several rows match, the MOST SPECIFIC wins: "boneless chicken thighs"
 * matches both "Chicken thighs (boneless)" and "Chicken thighs (bone-in)" on
 * the word "thigh", and the one whose qualifier also appears in your
 * ingredient is the one you meant. Ties break toward more matched terms, then
 * the longer term, then alphabetically so the answer never wobbles.
 *
 * `links` is the user's airFryerLinks map (guide key → the ingredient name they
 * tied it to). An explicit link is a stated fact, so it outranks any heuristic.
 */
export function airFryerForIngredient(ingredientName, guideRows = [], links = {}) {
  const name = String(ingredientName || '').trim();
  if (!name) return null;
  const mine = ` ${singularize(normalize(name))} `;

  let best = null;
  for (const row of guideRows) {
    const key = String(row?.name || '').trim().toLowerCase();
    const linked = links?.[key];
    const terms = [...new Set(linked ? [...guideTerms(row?.name), ...guideTerms(linked)] : guideTerms(row?.name))];
    if (terms.length === 0) continue;
    const hits = terms.filter(term => mine.includes(` ${term} `));
    if (hits.length === 0) continue;

    // A qualifier the guide puts in parentheses — "(boneless)", "(frozen)" —
    // is dropped by normalize, so check the raw row name for it separately.
    // It is what separates two rows that match on the same noun.
    const quals = String(row?.name || '').toLowerCase().match(/\(([^)]*)\)/g) || [];
    // Whole words, like everything else here. Substring matching files
    // "boneless chicken thighs" under the (bone-in) row, because "bone" is
    // inside "boneless" — which is the exact opposite of what was asked for.
    const qualHit = quals.some(q => {
      const words = q.replace(/[()]/g, '').split(/[^a-z]+/).filter(w => w.length >= 3);
      return words.some(w => mine.includes(` ${w} `));
    });

    const longest = hits.reduce((n, t) => Math.max(n, t.length), 0);
    const cand = {
      row,
      linked: !!linked,
      qualHit,
      hits: hits.length,
      longest,
    };
    if (!best || betterAirFryerMatch(cand, best)) best = cand;
  }
  return best ? best.row : null;
}

function betterAirFryerMatch(a, b) {
  if (a.linked !== b.linked) return a.linked;
  if (a.qualHit !== b.qualHit) return a.qualHit;
  if (a.hits !== b.hits) return a.hits > b.hits;
  if (a.longest !== b.longest) return a.longest > b.longest;
  return String(a.row.name).localeCompare(String(b.row.name), undefined, { sensitivity: 'base' }) < 0;
}

/**
 * One guide row written as a recipe step.
 *
 * Reads as an instruction ("Air fry the chicken breast at…") rather than as a
 * table row, because it is going to sit in a numbered list between steps
 * someone wrote by hand. The note is appended verbatim — it is the sentence
 * that makes the thing come out right, and paraphrasing it would lose that.
 */
export function airFryerStepText(row, ingredientName = '') {
  if (!row) return '';
  const what = String(ingredientName || row.name || '').trim().toLowerCase();
  const time = row.min && row.max && row.min !== row.max
    ? `${row.min}–${row.max} min`
    : `${row.min || row.max} min`;
  let s = `Air fry the ${what} at ${row.tempF}°F for ${time}`;
  if (row.doneF) s += `, until it reaches ${row.doneF}°F inside`;
  s += '.';
  const note = String(row.note || '').trim();
  if (note) s += ` ${note}`;
  return s;
}

/**
 * The guide as this user actually has it: the built-in rows, with their own
 * edits and additions layered over the top by name, and anything they hid
 * dropped.
 *
 * Shared with the recipe popup so an instruction imported into a recipe uses
 * the temperature they corrected on the air fryer page rather than the shipped
 * default. Two copies of this merge would mean the guide could tell you 375°F
 * in one place and 390°F in the other, which is worse than either number.
 */
export function mergeAirFryerGuide(builtIn = [], mine = [], hidden = []) {
  const key = (name) => String(name || '').trim().toLowerCase();
  const byKey = new Map();
  for (const row of builtIn) byKey.set(key(row?.name), { ...row, source: 'built-in' });
  for (const row of mine || []) {
    const k = key(row?.name);
    if (!k) continue;
    byKey.set(k, {
      ...row,
      source: byKey.has(k) ? 'edited' : 'mine',
      cat: row.cat || byKey.get(k)?.cat || 'Vegetables',
      // Only when the override doesn't have the key at all — which means it was
      // saved before `stop` existed, not that someone cleared it. An edit made
      // since then always writes the field, so an intentional '' survives and
      // an old override of the time doesn't blank out the flip instruction.
      stop: row.stop === undefined ? byKey.get(k)?.stop : row.stop,
    });
  }
  const hiddenSet = new Set((hidden || []).map(key));
  return Array.from(byKey.values()).filter(r => !hiddenSet.has(key(r.name)));
}

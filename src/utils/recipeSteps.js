// Inserting a step into the middle of a recipe.
//
// Steps are a plain array, but three other fields are keyed BY STEP INDEX —
// stepIngredients, stepSections and stepTitles. Splice a step into the middle
// without shifting all three and every step below it silently inherits the
// wrong ingredients, the wrong section header and the wrong title. Nothing
// throws; you find out while cooking.
//
// removeStep in RecipeDetail already does the shift-down half of this inline.
// This is the shift-up half, extracted because it is the same trap and worth
// testing once rather than trusting twice.

/**
 * Step text as bare words: HTML out (it comes from a contentEditable),
 * entities and punctuation out, lowercased, and padded with a space at each end
 * so callers can test for a WHOLE word.
 *
 * Punctuation has to go or "oil." at the end of a sentence never matches, and
 * whole-word testing has to replace substring testing or the ingredient "oil"
 * matches "boil the water" — the same trap the air fryer qualifier matching
 * fell into with "bone" inside "boneless".
 */
function plain(text) {
  const bare = String(text || '')
    .replace(/<[^>]*>/g, ' ')
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return bare ? ` ${bare} ` : '';
}

/**
 * The FIRST step that is about `ingredientIndex`, or -1.
 *
 * The explicit assignment wins: stepIngredients is what cook mode highlights
 * from, so if the recipe says step 3 is the chicken step, that is the answer.
 * Only when nothing is assigned does it read the step text, which is the same
 * fallback cook mode uses to populate itself — whole ingredient name, or a
 * word from it long enough not to be "cup" or "oil".
 *
 * First rather than last, which is not the obvious choice and was wrong the
 * other way round. An ingredient's LAST mention is usually the end of the
 * recipe — "rest the chicken 5 minutes, then serve" — so anchoring there put
 * "Air fry the chicken" after the resting and the serving. Its first mention is
 * where the recipe starts dealing with it, and a cooking instruction inserted
 * just after that reads in the right order.
 */
export function firstStepForIngredient(steps = [], stepIngredients = {}, ingredientIndex = -1, ingredientName = '') {
  let found = -1;
  const assigned = stepIngredients && typeof stepIngredients === 'object' ? stepIngredients : {};
  for (const [key, list] of Object.entries(assigned)) {
    const i = parseInt(key, 10);
    if (!Number.isInteger(i) || i < 0 || i >= steps.length) continue;
    if (!Array.isArray(list) || !list.includes(ingredientIndex)) continue;
    found = found < 0 ? i : Math.min(found, i);
  }
  if (found >= 0) return found;

  const name = plain(ingredientName).trim();
  if (!name) return -1;
  // A single word only carries the match when it is distinctive enough. "cup",
  // "oil" or "red" out of a longer name would land the step anywhere.
  const words = name.split(' ').filter(w => w.length > 3);
  for (let i = 0; i < steps.length; i++) {
    const hay = plain(steps[i]);
    if (!hay) continue;
    if (hay.includes(` ${name} `) || words.some(w => hay.includes(` ${w} `))) return i;
  }
  return found;
}

/**
 * Put `text` in at `at`, shifting the three index-keyed maps to match.
 *
 * `at` beyond the end (or negative) appends, which is what the callers want
 * when nothing in the recipe mentions the ingredient yet.
 *
 * @returns {{steps, stepIngredients, stepSections, stepTitles}} — new objects,
 *          the input untouched.
 */
export function insertStep(fields, at, text, ingredientIndex = null) {
  const steps = Array.isArray(fields?.steps) ? fields.steps : [];
  const index = Number.isInteger(at) && at >= 0 && at <= steps.length ? at : steps.length;

  const nextSteps = [...steps.slice(0, index), text, ...steps.slice(index)];

  const shift = (map) => {
    const out = {};
    for (const [key, val] of Object.entries(map && typeof map === 'object' ? map : {})) {
      const k = parseInt(key, 10);
      if (!Number.isInteger(k)) continue;
      out[k < index ? k : k + 1] = val;
    }
    return out;
  };

  const stepIngredients = shift(fields?.stepIngredients);
  // Assigning the ingredient to the new step is only right when no other step
  // has claimed it. Cook mode treats stepIngredients as a PARTITION — its
  // "unassigned" list excludes anything assigned to any step, and it renders a
  // row per assigned ingredient per step — so a second claim shows the
  // ingredient, and its quantity, twice in the instructions.
  //
  // The existing claim is also the better one to keep: the recipe already
  // decided which step that ingredient belongs beside, and an imported step
  // should not quietly move it.
  if (Number.isInteger(ingredientIndex) && ingredientIndex >= 0) {
    const claimedElsewhere = Object.values(stepIngredients)
      .some(list => Array.isArray(list) && list.includes(ingredientIndex));
    if (!claimedElsewhere) stepIngredients[index] = [ingredientIndex];
  }

  return {
    steps: nextSteps,
    stepIngredients,
    stepSections: shift(fields?.stepSections),
    stepTitles: shift(fields?.stepTitles),
  };
}

/**
 * Where a generated step about one ingredient should go: directly after the
 * last step that is already about it, or at the end when there is none.
 */
export function insertPointForIngredient(steps, stepIngredients, ingredientIndex, ingredientName) {
  const first = firstStepForIngredient(steps, stepIngredients, ingredientIndex, ingredientName);
  return first < 0 ? (steps || []).length : first + 1;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { insertStep, firstStepForIngredient, insertPointForIngredient } from './recipeSteps.js';

// A recipe where ingredient 0 is the chicken and ingredient 1 the sprouts.
const RECIPE = {
  steps: [
    'Heat the oven.',
    'Season the chicken breasts with salt.',
    'Halve the brussels sprouts.',
    'Rest the chicken for 5 minutes.',
  ],
  stepIngredients: { 1: [0], 2: [1], 3: [0] },
  stepSections: { 0: 'Prep', 2: 'Cook' },
  stepTitles: { 1: 'Season', 3: 'Rest' },
};

// ── finding the step ─────────────────────────────────────────────────────────

test('the explicit assignment wins, and the FIRST one is the answer', () => {
  // Chicken is step 1 (season) and step 3 (rest). Anchoring on the LAST
  // mention put the air fryer step after "rest, then serve" — cooking the
  // chicken after serving it. Its first mention is where the recipe starts
  // dealing with it.
  assert.equal(firstStepForIngredient(RECIPE.steps, RECIPE.stepIngredients, 0, 'chicken breasts'), 1);
  assert.equal(firstStepForIngredient(RECIPE.steps, RECIPE.stepIngredients, 1, 'brussels sprouts'), 2);
});

test('falls back to the step text when nothing is assigned', () => {
  // Recipes that never populated stepIngredients still have to work — this is
  // the same matching cook mode uses to populate itself.
  assert.equal(firstStepForIngredient(RECIPE.steps, {}, 0, 'chicken breasts'), 1);
  assert.equal(firstStepForIngredient(RECIPE.steps, {}, 1, 'brussels sprouts'), 2);
});

test('matches whole words, so "oil" is not found inside "boil"', () => {
  // The same trap the air fryer qualifier matching fell into with "bone" in
  // "boneless". A substring test puts the step after "Boil the water".
  assert.equal(firstStepForIngredient(['Boil the water.'], {}, 0, 'oil'), -1);
  assert.equal(firstStepForIngredient(['Drizzle with oil.'], {}, 0, 'oil'), 0);
  // Punctuation must not hide the word it is attached to.
  assert.equal(firstStepForIngredient(['Finish with oil'], {}, 0, 'oil'), 0);
});

test('a short word out of a longer name does not drag the step somewhere odd', () => {
  // "olive oil" should not attach itself to every step that says "oil"; only
  // words long enough to be distinctive carry a match on their own.
  const steps = ['Add a cup of stock.', 'Drizzle with oil.', 'Add the olive oil.'];
  assert.equal(firstStepForIngredient(steps, {}, 0, 'olive oil'), 2);
});

test('reads through the HTML a contentEditable leaves behind', () => {
  const steps = ['<b>Season</b> the <i>chicken&nbsp;breasts</i>.'];
  assert.equal(firstStepForIngredient(steps, {}, 0, 'chicken'), 0);
});

test('says -1 when the recipe never mentions it', () => {
  assert.equal(firstStepForIngredient(RECIPE.steps, RECIPE.stepIngredients, 9, 'halloumi'), -1);
  assert.equal(firstStepForIngredient([], {}, 0, 'chicken'), -1);
  assert.equal(firstStepForIngredient(RECIPE.steps, {}, 0, ''), -1);
});

test('ignores an assignment pointing past the end of the steps', () => {
  // Stale maps happen; a key of 99 must not become the insert point.
  assert.equal(firstStepForIngredient(RECIPE.steps, { 99: [0] }, 0, 'nothing here'), -1);
});

test('the insert point is just after the step it found, or the end', () => {
  assert.equal(insertPointForIngredient(RECIPE.steps, RECIPE.stepIngredients, 0, 'chicken breasts'), 2);
  assert.equal(insertPointForIngredient(RECIPE.steps, RECIPE.stepIngredients, 1, 'brussels sprouts'), 3);
  assert.equal(insertPointForIngredient(RECIPE.steps, RECIPE.stepIngredients, 9, 'halloumi'), 4);
});

// ── inserting ────────────────────────────────────────────────────────────────

test('inserting in the middle shifts every index-keyed map with it', () => {
  // The whole point. Without the shift, the sprouts step keeps ingredient 1
  // while "Cook" and "Rest" slide onto the wrong steps.
  const out = insertStep(RECIPE, 3, 'Air fry the sprouts.', 1);
  assert.deepEqual(out.steps, [
    'Heat the oven.',
    'Season the chicken breasts with salt.',
    'Halve the brussels sprouts.',
    'Air fry the sprouts.',
    'Rest the chicken for 5 minutes.',
  ]);
  // 3:[0] was the rest step; it is now step 4. The new step 3 does NOT claim
  // ingredient 1 — step 2 already has it, and two claims render it twice.
  assert.deepEqual(out.stepIngredients, { 1: [0], 2: [1], 4: [0] });
  assert.deepEqual(out.stepSections, { 0: 'Prep', 2: 'Cook' });
  assert.deepEqual(out.stepTitles, { 1: 'Season', 4: 'Rest' });
});

test('inserting at the very front shifts everything', () => {
  const out = insertStep(RECIPE, 0, 'Read the recipe.', null);
  assert.equal(out.steps[0], 'Read the recipe.');
  assert.deepEqual(out.stepIngredients, { 2: [0], 3: [1], 4: [0] });
  assert.deepEqual(out.stepSections, { 1: 'Prep', 3: 'Cook' });
  assert.deepEqual(out.stepTitles, { 2: 'Season', 4: 'Rest' });
});

test('appending leaves the existing maps exactly as they were', () => {
  const out = insertStep(RECIPE, RECIPE.steps.length, 'Serve.', null);
  assert.equal(out.steps.length, 5);
  assert.deepEqual(out.stepIngredients, RECIPE.stepIngredients);
  assert.deepEqual(out.stepSections, RECIPE.stepSections);
  assert.deepEqual(out.stepTitles, RECIPE.stepTitles);
});

test('an out-of-range or missing position appends rather than throwing', () => {
  for (const at of [99, -1, null, undefined, NaN, 'three']) {
    const out = insertStep(RECIPE, at, 'Serve.');
    assert.equal(out.steps.length, 5, String(at));
    assert.equal(out.steps[4], 'Serve.', String(at));
  }
});

test('the new step is tied to the ingredient it came from', () => {
  // Ingredient 2 is in the recipe but no step claims it, so the new step does.
  const out = insertStep(RECIPE, 4, 'Fry the halloumi.', 2);
  assert.deepEqual(out.stepIngredients[4], [2]);
});

test('no ingredient given means no assignment invented for it', () => {
  const out = insertStep(RECIPE, 4, 'Serve.', null);
  assert.equal(out.stepIngredients[4], undefined);
});

test('does not mutate the recipe it was handed', () => {
  const before = JSON.parse(JSON.stringify(RECIPE));
  insertStep(RECIPE, 1, 'Something.', 0);
  assert.deepEqual(RECIPE, before);
});

test('survives a recipe with no steps and no maps at all', () => {
  const out = insertStep({}, 0, 'Only step.', 0);
  assert.deepEqual(out.steps, ['Only step.']);
  assert.deepEqual(out.stepIngredients, { 0: [0] });
  assert.deepEqual(out.stepSections, {});
  assert.deepEqual(out.stepTitles, {});
});

test('does not claim an ingredient another step already has', () => {
  // Cook mode renders a row per assigned ingredient per step and treats the
  // assignment as a partition, so a second claim listed the ingredient — and
  // its quantity — twice in the instructions. The recipe already decided where
  // the chicken belongs; an imported step must not stake a second claim.
  const out = insertStep(RECIPE, 2, 'Air fry the chicken.', 0);   // 0 is on step 1
  assert.equal(out.stepIngredients[2], undefined, 'no second claim on the new step');
  assert.deepEqual(out.stepIngredients[1], [0], 'the original claim is left alone');
  const claimsBefore = Object.values(RECIPE.stepIngredients).flat().filter(i => i === 0).length;
  const claimsAfter = Object.values(out.stepIngredients).flat().filter(i => i === 0).length;
  assert.equal(claimsAfter, claimsBefore, 'the insert adds no new claim');
});

test('still claims it when no step had it', () => {
  // The other half: a recipe with nothing assigned needs the new step to carry
  // the ingredient, or cook mode shows the step with no ingredient beside it.
  const bare = { steps: ['Heat the oven.'], stepIngredients: {}, stepSections: {}, stepTitles: {} };
  const out = insertStep(bare, 1, 'Air fry the chicken.', 0);
  assert.deepEqual(out.stepIngredients[1], [0]);
});

test('an ingredient claimed by a step that shifted is still seen as claimed', () => {
  // The check has to run against the SHIFTED map, not the original — otherwise
  // inserting above the claiming step misses it and duplicates anyway.
  const out = insertStep(RECIPE, 0, 'Read the recipe.', 0);   // 0 was on step 1, now 2
  assert.equal(out.stepIngredients[0], undefined);
  assert.deepEqual(out.stepIngredients[2], [0]);
});

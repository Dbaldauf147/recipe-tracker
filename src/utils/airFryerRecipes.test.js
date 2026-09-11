import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guideTerms, ingredientMatchesTerms, indexRecipesByGuide,
  rankIngredientsForGuide, bestIngredientForGuide, CONFIDENT_MATCH_SCORE,
  airFryerForIngredient, airFryerStepText, mergeAirFryerGuide,
} from './airFryerRecipes.js';
import GUIDE from '../data/airFryerGuide.js';

// The guide is written for a human holding food; recipe ingredients are written
// for a shopping list. Everything here is about surviving that gap without
// inventing matches that aren't there.

test('guideTerms strips qualifiers and splits alternatives', () => {
  assert.deepEqual(guideTerms('Chicken breast (boneless)'), ['chicken breast']);
  assert.deepEqual(guideTerms('Spring rolls / egg rolls (frozen)'), ['spring roll', 'egg roll']);
  assert.deepEqual(guideTerms('Frozen vegetables'), ['frozen vegetable']);
  assert.deepEqual(guideTerms('Hard "boiled" eggs'), ['hard boiled egg']);
});

test('plurals match in both directions', () => {
  const terms = guideTerms('Chicken breast (boneless)');
  assert.ok(ingredientMatchesTerms('chicken breasts', terms));
  assert.ok(ingredientMatchesTerms('2 boneless chicken breast, diced', terms));
  assert.ok(ingredientMatchesTerms('Chicken Breast', terms));
});

// The reason matching is whole-word rather than substring. Both of these are
// real pantry items that a naive `includes` files under the wrong row.
test('a substring is not a match', () => {
  assert.ok(!ingredientMatchesTerms('toasted sesame oil', guideTerms('Toast')));
  assert.ok(!ingredientMatchesTerms('nutmeg', guideTerms('Nuts (toasting)')));
  assert.ok(ingredientMatchesTerms('mixed nuts', guideTerms('Nuts (toasting)')));
});

// Both sides run through the same singulariser, so a word it stems WRONGLY can
// still match itself — the failures are the ones where the guide and the recipe
// spell the same food differently. Hence potato/potatoes.
test('food plurals stem to something that still matches', () => {
  assert.deepEqual(guideTerms('Asparagus'), ['asparagus']);
  assert.ok(ingredientMatchesTerms('asparagus', guideTerms('Asparagus')));
  assert.ok(ingredientMatchesTerms('couscous', guideTerms('Couscous')));

  const potato = guideTerms('Baby potatoes');
  assert.deepEqual(potato, ['baby potato']);
  assert.ok(ingredientMatchesTerms('baby potato', potato), 'singular ingredient');
  assert.ok(ingredientMatchesTerms('1 lb baby potatoes, halved', potato), 'plural ingredient');

  assert.ok(ingredientMatchesTerms('blueberry', guideTerms('Blueberries')));
});

test('a more specific row does not swallow a general ingredient', () => {
  // "chicken" alone isn't enough to claim the breast row — the whole phrase
  // has to be there, or every chicken recipe would land on every chicken row.
  assert.ok(!ingredientMatchesTerms('chicken', guideTerms('Chicken breast (boneless)')));
});

test('indexRecipesByGuide maps recipes and flags the weekly ones', () => {
  const guide = [
    { name: 'Chicken breast (boneless)' },
    { name: 'Brussels sprouts' },
    { name: 'Toast' },
  ];
  const recipes = [
    { id: 'r1', title: 'Weeknight chicken', ingredients: [{ ingredient: 'chicken breasts' }, { ingredient: 'olive oil' }] },
    { id: 'r2', title: 'Sheet pan dinner', ingredients: [{ ingredient: 'Brussels sprouts' }, { ingredient: 'chicken breast' }] },
    { id: 'r3', title: 'Salad', ingredients: [{ ingredient: 'toasted sesame oil' }] },
  ];
  const index = indexRecipesByGuide(guide, recipes, new Set(['r2']));

  assert.deepEqual(
    index['chicken breast (boneless)'].recipes.map(r => r.title),
    ['Sheet pan dinner', 'Weeknight chicken'],
  );
  // Only r2 is on the plan, so only it counts toward "this week".
  assert.deepEqual(index['chicken breast (boneless)'].weekRecipes.map(r => r.id), ['r2']);
  assert.deepEqual(index['brussels sprouts'].weekRecipes.map(r => r.id), ['r2']);
  // The salad's toasted sesame oil must not make Toast a weekly row.
  assert.deepEqual(index['toast'].recipes, []);
  assert.deepEqual(index['toast'].weekRecipes, []);
});

// Linking a row to a database ingredient is how you teach it a name your
// recipes actually use. It has to ADD reach without losing what already worked.
test('a linked ingredient catches recipes the row name misses', () => {
  const guide = [{ name: 'Chicken breast (boneless)' }];
  const recipes = [
    { id: 'r1', title: 'Cutlet night', ingredients: [{ ingredient: 'chicken cutlets' }] },
    { id: 'r2', title: 'Plain', ingredients: [{ ingredient: 'chicken breasts' }] },
  ];
  const key = 'chicken breast (boneless)';

  // Unlinked: the cutlets are invisible, because nothing about the row's name
  // says "cutlet".
  const before = indexRecipesByGuide(guide, recipes, new Set());
  assert.deepEqual(before[key].recipes.map(r => r.id), ['r2']);

  // Linked: the cutlets are found AND the original match survives.
  const after = indexRecipesByGuide(guide, recipes, new Set(), { [key]: 'chicken cutlet' });
  assert.deepEqual(after[key].recipes.map(r => r.id).sort(), ['r1', 'r2']);
});

test('links for unknown rows are ignored, and no link is the old behaviour', () => {
  const guide = [{ name: 'Toast' }];
  const recipes = [{ id: 'r1', title: 'Breakfast', ingredients: [{ ingredient: 'sourdough bread' }] }];
  assert.deepEqual(indexRecipesByGuide(guide, recipes, new Set(), { 'not a row': 'bread' })['toast'].recipes, []);
  assert.deepEqual(
    indexRecipesByGuide(guide, recipes, new Set(), { toast: 'sourdough bread' })['toast'].recipes.map(r => r.id),
    ['r1'],
  );
});

test('every guide row gets an entry, even with no recipes at all', () => {
  const index = indexRecipesByGuide(GUIDE, [], new Set());
  assert.equal(Object.keys(index).length > 0, true);
  for (const row of GUIDE) {
    const entry = index[row.name.trim().toLowerCase()];
    assert.ok(entry, `no entry for ${row.name}`);
    assert.deepEqual(entry.recipes, []);
  }
});

test('missing and malformed inputs do not throw', () => {
  assert.deepEqual(indexRecipesByGuide([], undefined, undefined), {});
  const index = indexRecipesByGuide(
    [{ name: 'Toast' }],
    [{ id: 'r1', title: 'No ingredients' }, { id: 'r2', ingredients: [{}, { ingredient: '' }] }],
    ['r1'],
  );
  assert.deepEqual(index['toast'].recipes, []);
});

// ── Predicting which of YOUR ingredients a guide row is ──────────────────────
// The picker used to be a plain search box over the whole database: you read
// "Chicken breast (boneless)" and typed "chick" yourself. These rank it for you.

test('rankIngredientsForGuide matches when the guide is the longer name', () => {
  // Guide "Broccoli florets" vs your plain "Broccoli" — your name is a prefix
  // of the guide term, which only the reverse direction catches.
  const ranked = rankIngredientsForGuide('Broccoli florets', ['Broccoli', 'Brussels sprouts']);
  assert.equal(ranked[0].name, 'Broccoli');
  assert.ok(ranked[0].score <= CONFIDENT_MATCH_SCORE);
});

test('rankIngredientsForGuide matches when YOUR name is the longer one', () => {
  const ranked = rankIngredientsForGuide('Chicken breast (boneless)', ['Chicken breasts, boneless', 'Beef mince']);
  assert.equal(ranked[0].name, 'Chicken breasts, boneless');
  assert.ok(ranked[0].score <= CONFIDENT_MATCH_SCORE);
});

test('plurals meet in the middle', () => {
  assert.equal(rankIngredientsForGuide('Potatoes (whole)', ['Potato'])[0].score, 0);
  assert.equal(rankIngredientsForGuide('Potato', ['Potatoes'])[0].score, 0);
});

test('either side of a slash can be the match', () => {
  const ranked = rankIngredientsForGuide('Spring rolls / egg rolls (frozen)', ['Egg roll wrappers', 'Rice']);
  assert.equal(ranked[0].name, 'Egg roll wrappers');
});

test('ranking puts the exact name above the merely related one', () => {
  const ranked = rankIngredientsForGuide('Salmon fillet', ['Salmon fillet', 'Salmon fillet, skin on', 'Smoked salmon']);
  assert.equal(ranked[0].name, 'Salmon fillet');
  assert.equal(ranked[0].score, 0);
});

test('unrelated ingredients are left out entirely', () => {
  assert.deepEqual(rankIngredientsForGuide('Chicken breast (boneless)', ['Flour', 'Caster sugar']), []);
});

test('bestIngredientForGuide only offers a confident match', () => {
  // Exact and prefix are offered as one tap...
  assert.equal(bestIngredientForGuide('Broccoli florets', ['Broccoli']), 'Broccoli');
  // ...a shared whole word in the middle of a longer name is not. "Toasted
  // sesame oil" contains "sesame" but is emphatically not the sesame row.
  assert.equal(bestIngredientForGuide('Sesame seeds', ['Toasted sesame oil']), '');
  assert.equal(bestIngredientForGuide('Chicken breast (boneless)', ['Flour']), '');
});

test('an empty or unusable database suggests nothing, and does not throw', () => {
  assert.deepEqual(rankIngredientsForGuide('Chicken breast', []), []);
  assert.deepEqual(rankIngredientsForGuide('Chicken breast', [null, '', '   ']), []);
  assert.deepEqual(rankIngredientsForGuide('', ['Chicken']), []);
  assert.equal(bestIngredientForGuide('', []), '');
});

test('every built-in guide row survives ranking against a real-ish database', () => {
  // Guards the whole guide against a row name that makes the scorer throw.
  const db = ['Chicken breasts', 'Potato', 'Broccoli', 'Salmon fillet', 'Halloumi'];
  for (const row of GUIDE) {
    assert.doesNotThrow(() => rankIngredientsForGuide(row.name, db), row.name);
  }
});

// ── ingredient → guide row ───────────────────────────────────────────────────
// The reverse direction, used by the recipe popup to drop air-fryer
// instructions into a step. Wrong row = cooking fish at chicken temperatures,
// so these are about what it must REFUSE as much as what it finds.

test('finds the row for an ingredient written the way a recipe writes it', () => {
  assert.equal(airFryerForIngredient('chicken breasts', GUIDE).name, 'Chicken breast (boneless)');
  assert.equal(airFryerForIngredient('Salmon fillet', GUIDE).name, 'Salmon fillet (6 oz)');
  assert.equal(airFryerForIngredient('brussels sprouts', GUIDE).name, 'Brussels sprouts (halved)');
});

test('a parenthetical qualifier picks between two rows of the same thing', () => {
  // Both rows match on "chicken thigh"; the qualifier is the whole difference,
  // and it is 20 minutes at 400°F vs 16 at 400°F with different done temps.
  assert.equal(airFryerForIngredient('boneless chicken thighs', GUIDE).name, 'Chicken thighs (boneless)');
  assert.equal(airFryerForIngredient('bone-in chicken thighs', GUIDE).name, 'Chicken thighs (bone-in)');
});

test('the qualifier match is whole-word — "bone" is not inside "boneless"', () => {
  // The bug this replaced: substring matching filed "boneless chicken thighs"
  // under the (bone-in) row, i.e. exactly backwards.
  const row = airFryerForIngredient('boneless chicken thighs', GUIDE);
  assert.doesNotMatch(row.name, /bone-in/i);
});

test('refuses an ingredient the guide has nothing to say about', () => {
  for (const name of ['olive oil', 'salt', 'vanilla extract', 'water']) {
    assert.equal(airFryerForIngredient(name, GUIDE), null, name);
  }
});

test('refuses blank and junk input rather than guessing', () => {
  assert.equal(airFryerForIngredient('', GUIDE), null);
  assert.equal(airFryerForIngredient('   ', GUIDE), null);
  assert.equal(airFryerForIngredient(null, GUIDE), null);
  assert.equal(airFryerForIngredient('chicken', []), null);
  assert.equal(airFryerForIngredient('chicken', undefined), null);
});

test('does not match on a fragment of a longer word', () => {
  // "Toast" must not claim "toasted sesame oil", the same trap the forward
  // matcher documents.
  const row = airFryerForIngredient('toasted sesame oil', GUIDE);
  assert.equal(row, null);
});

test('an explicit link outranks the heuristic', () => {
  const rows = [
    { name: 'Halloumi', cat: 'Cheese', tempF: 390, min: 8, max: 10 },
    { name: 'Tofu (extra firm)', cat: 'Vegetarian', tempF: 400, min: 15, max: 18 },
  ];
  // Nothing matches "paneer" on its own …
  assert.equal(airFryerForIngredient('paneer cubes', rows), null);
  // … until the user ties the Halloumi row to it on the air fryer page.
  const links = { halloumi: 'Paneer' };
  assert.equal(airFryerForIngredient('paneer cubes', rows, links).name, 'Halloumi');
});

test('every guide row can be looked up by its own name', () => {
  // A row nothing can reach is a row that never reaches a recipe.
  for (const row of GUIDE) {
    assert.notEqual(airFryerForIngredient(row.name, GUIDE), null, row.name);
  }
});

// ── the step it writes ───────────────────────────────────────────────────────

test('reads as an instruction, not a table row', () => {
  const row = { name: 'Chicken breast (boneless)', tempF: 375, min: 18, max: 22, doneF: 165, note: 'Flip halfway.' };
  assert.equal(
    airFryerStepText(row, 'chicken breasts'),
    'Air fry the chicken breasts at 375°F for 18–22 min, until it reaches 165°F inside. Flip halfway.',
  );
});

test('drops the done temperature for things that have none', () => {
  const row = { name: 'Broccoli florets', tempF: 400, min: 8, max: 10, note: 'Shake once.' };
  assert.equal(airFryerStepText(row, 'broccoli'), 'Air fry the broccoli at 400°F for 8–10 min. Shake once.');
});

test('collapses a range that is not a range, and survives a missing note', () => {
  assert.equal(
    airFryerStepText({ name: 'Bacon', tempF: 350, min: 9, max: 9 }, 'bacon'),
    'Air fry the bacon at 350°F for 9 min.',
  );
});

test('falls back to the row name when no ingredient name is given', () => {
  const row = { name: 'Halloumi', tempF: 390, min: 8, max: 10 };
  assert.match(airFryerStepText(row), /^Air fry the halloumi at 390°F/);
});

test('writes nothing for no row', () => {
  assert.equal(airFryerStepText(null, 'chicken'), '');
});

// ── The mid-cook stop ────────────────────────────────────────────────────────
//
// The row renders `stop` as a real column, so "every row has one" is an
// invariant of the data, not a hope. A blank would read as "nothing to do" on a
// page whose standing rule is that you flip at halfway unless told otherwise.

test('every built-in row says when to open the basket', () => {
  const silent = GUIDE.filter(r => !String(r.stop || '').trim());
  assert.deepEqual(silent.map(r => r.name), []);
});

test('a stop stays short enough to read at arm\'s length', () => {
  const tooLong = GUIDE.filter(r => r.stop.length > 18).map(r => `${r.name}: ${r.stop}`);
  assert.deepEqual(tooLong, []);
});

test('an override saved before `stop` existed keeps the built-in one', () => {
  const builtIn = [{ name: 'Chicken wings', tempF: 400, min: 20, max: 24, stop: 'Shake every 8 min' }];
  // No `stop` key at all — the shape every edit written before this field.
  const mine = [{ name: 'Chicken wings', tempF: 390, min: 24, max: 28 }];
  const [row] = mergeAirFryerGuide(builtIn, mine, []);
  assert.equal(row.stop, 'Shake every 8 min');
  assert.equal(row.tempF, 390, 'the edit itself still wins');
  assert.equal(row.source, 'edited');
});

test('clearing the stop on purpose is not undone by the built-in', () => {
  const builtIn = [{ name: 'Chicken wings', tempF: 400, min: 20, max: 24, stop: 'Shake every 8 min' }];
  const mine = [{ name: 'Chicken wings', tempF: 400, min: 20, max: 24, stop: '' }];
  const [row] = mergeAirFryerGuide(builtIn, mine, []);
  assert.equal(row.stop, '');
});

test('a row of your own carries its own stop, with nothing to fall back to', () => {
  const [row] = mergeAirFryerGuide([], [{ name: 'Halloumi', tempF: 390, min: 8, max: 10, stop: 'Flip halfway' }], []);
  assert.equal(row.stop, 'Flip halfway');
  assert.equal(row.source, 'mine');
});

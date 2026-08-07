import test from 'node:test';
import assert from 'node:assert/strict';
import {
  guideTerms, ingredientMatchesTerms, indexRecipesByGuide,
  rankIngredientsForGuide, bestIngredientForGuide, CONFIDENT_MATCH_SCORE,
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

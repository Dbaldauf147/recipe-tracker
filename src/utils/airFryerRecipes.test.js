import test from 'node:test';
import assert from 'node:assert/strict';
import { guideTerms, ingredientMatchesTerms, indexRecipesByGuide } from './airFryerRecipes.js';
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

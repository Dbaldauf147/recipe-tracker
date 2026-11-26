import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unmatchedIngredients, breakdownNameSuggestions, ingredientIndexByName } from './breakdownRows.js';

test('rows the lookup dropped are listed, matched and blank rows are not', () => {
  const ingredients = [
    { ingredient: 'mild Italian sausage' },
    { ingredient: '' },
    { ingredient: 'mystery spice blend', topping: true },
    { ingredient: 'heavy cream ' },
    { ingredient: 'mystery spice blend' },
  ];
  const items = [{ matchedTo: 'mild Italian sausage' }, { matchedTo: 'heavy cream' }];
  assert.deepEqual(unmatchedIngredients(items, ingredients), [{ ingredient: 'mystery spice blend', topping: true }]);
});

test('suggestions relax when nothing close is in the list', () => {
  const db = ['parmesan cheese', 'heavy cream', 'bone broth', 'garlic'];
  assert.deepEqual(breakdownNameSuggestions('parmesan chese', db).slice(0, 1), ['parmesan cheese']);
  // "beef or chicken bone broth" is too far from "bone broth" for the strict bar
  // but should still be offered.
  assert.ok(breakdownNameSuggestions('beef or chicken bone broth', db).includes('bone broth'));
  assert.deepEqual(breakdownNameSuggestions('', db), []);
});

test('finds the row to rename by its text, blank rows counted', () => {
  const ingredients = [{ ingredient: '' }, { ingredient: 'Heavy Cream' }, { ingredient: 'spinach' }];
  assert.equal(ingredientIndexByName(ingredients, 'spinach'), 2);
  assert.equal(ingredientIndexByName(ingredients, 'heavy cream'), 1);
  assert.equal(ingredientIndexByName(ingredients, 'gone'), -1);
});

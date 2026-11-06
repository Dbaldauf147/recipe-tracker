import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoRecipeReply, hasRecipeAmounts } from '../../lib/videoRecipe.js';

test('hasRecipeAmounts spots real amounts, not hashtags', () => {
  assert.equal(hasRecipeAmounts('2 cups rice, 1 tbsp oil'), true);
  assert.equal(hasRecipeAmounts('150g chicken'), true);
  assert.equal(hasRecipeAmounts('50 grams of protein per serving'), true);
  assert.equal(hasRecipeAmounts('easy dinner 🔥 #recipe #highprotein'), false);
  assert.equal(hasRecipeAmounts('4 ingredients only'), false);
  assert.equal(hasRecipeAmounts(''), false);
});

test('parseVideoRecipeReply reads a fenced JSON reply', () => {
  const r = parseVideoRecipeReply('```json\n{"title":"Salsa Chicken","titleSource":"screen","servings":4,"ingredients":[{"quantity":"1","measurement":"cup","ingredient":"rice"},{"ingredient":""}],"instructions":["Mix.","Cook."],"amountsFromVideo":true}\n```');
  assert.equal(r.title, 'Salsa Chicken');
  assert.equal(r.titleSource, 'screen');
  assert.equal(r.servings, '4');
  assert.deepEqual(r.ingredients, [{ quantity: '1', measurement: 'cup', ingredient: 'rice' }]);
  assert.equal(r.instructions, 'Mix.\nCook.');
  assert.equal(r.amountsFromVideo, true);
});

test('parseVideoRecipeReply accepts plain-string ingredients', () => {
  const r = parseVideoRecipeReply('{"title":"Toast","ingredients":["bread"],"instructions":"Toast it."}');
  assert.deepEqual(r.ingredients, [{ quantity: '', measurement: '', ingredient: 'bread' }]);
  assert.equal(r.amountsFromVideo, false);
  assert.equal(r.titleSource, '');
});

test('parseVideoRecipeReply returns null for no recipe or junk', () => {
  assert.equal(parseVideoRecipeReply('{"error":"no recipe"}'), null);
  assert.equal(parseVideoRecipeReply('not json'), null);
  assert.equal(parseVideoRecipeReply('{"title":"","ingredients":[]}'), null);
  assert.equal(parseVideoRecipeReply(''), null);
});

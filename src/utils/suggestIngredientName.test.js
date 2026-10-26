// Tests for suggestIngredientName — the shopping list's "Name in your meals"
// suggestion. Mirrors the mobile app's suggestIngredientName.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanIngredientName, suggestIngredientName, suggestIngredientNames, headNoun, renameIngredientLines } from './suggestIngredientName.js';

const DB = ['Bananas', 'Yellow onion', 'Onion', 'Garlic', 'Red bell pepper', 'Brown rice', 'Rice, white, cooked'];

test('a name the DB already has needs no suggestion', () => {
  assert.equal(suggestIngredientName('garlic', DB), null);
  assert.equal(suggestIngredientName('Brown Rice', DB), null);
});

test('prep notes and sizes are stripped to find the DB row', () => {
  assert.equal(suggestIngredientName('2 large ripe bananas, sliced', DB), 'Bananas');
  assert.equal(suggestIngredientName('onion, finely diced', DB), 'Onion');
  assert.equal(suggestIngredientName('fresh garlic (minced)', DB), 'Garlic');
});

test('colour words are kept — they change what you buy', () => {
  assert.equal(suggestIngredientName('red bell peppers, chopped', DB), 'Red bell pepper');
});

test('no DB match falls back to the cleaned-up line', () => {
  assert.equal(suggestIngredientName('fresh cilantro, chopped', DB), 'Cilantro');
  assert.equal(suggestIngredientName('Cilantro', DB), null);
});

test('cleanIngredientName', () => {
  assert.equal(cleanIngredientName('1/2 cup chopped walnuts (toasted)'), 'Walnuts');
  assert.equal(cleanIngredientName('  '), '');
});

test('renameIngredientLines rewrites only matching lines, keeping the rest of each line', () => {
  const ings = [
    { ingredient: '2 Large Bananas ', quantity: '2', measurement: '' },
    { ingredient: 'Oats', quantity: '1', measurement: 'cup' },
  ];
  const out = renameIngredientLines(ings, '2 large bananas', 'Bananas');
  assert.deepEqual(out[0], { ingredient: 'Bananas', quantity: '2', measurement: '' });
  assert.equal(out[1], ings[1]);
  assert.equal(renameIngredientLines(ings, 'kale', 'Kale'), null);
});

test('headNoun is what the food IS, not its first word', () => {
  assert.equal(headNoun('Brown rice'), 'rice');
  assert.equal(headNoun('Rice, white, cooked'), 'rice');
  assert.equal(headNoun('Basmati rice (dry)'), 'rice');
  assert.equal(headNoun('Rice vinegar'), 'vinegar');
  assert.equal(headNoun('Rice noodles'), 'noodles');
});

const PANTRY = ['Rice vinegar', 'Rice noodles', 'Brown rice', 'Jasmine rice', 'Rice, white, cooked', 'Wild rice', 'Basmati rice (dry)', 'Rice cakes', 'Vinegar'];

test('rice suggests kinds of rice, never rice vinegar or rice noodles', () => {
  const out = suggestIngredientNames('rice', PANTRY);
  assert.deepEqual(new Set(out), new Set(['Brown rice', 'Jasmine rice', 'Rice, white, cooked', 'Wild rice', 'Basmati rice (dry)']));
  assert.equal(out[0], 'Rice, white, cooked'); // the DB's plain "rice" row first
  assert.equal(suggestIngredientName('rice', PANTRY), 'Rice, white, cooked');
});

test('the closest kind comes first, and the name itself is left out', () => {
  assert.equal(suggestIngredientNames('1 cup jasmine rice, rinsed', PANTRY)[0], 'Jasmine rice');
  assert.ok(!suggestIngredientNames('Brown rice', PANTRY).includes('Brown rice'));
  assert.ok(suggestIngredientNames('Brown rice', PANTRY).includes('Wild rice'));
});

test('no DB name of the same kind falls back to the cleaned line', () => {
  assert.deepEqual(suggestIngredientNames('2 cups arborio rice', ['Rice vinegar']), ['Arborio rice']);
  assert.deepEqual(suggestIngredientNames('Saffron', PANTRY), []);
});

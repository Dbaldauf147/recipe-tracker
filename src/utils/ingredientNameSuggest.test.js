// Tests for ingredientNameSuggest — Cook Mode's "did you mean" for a recipe
// ingredient's spelling. Run with `npm test`.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { nameSimilarity, suggestIngredientNames } from './ingredientNameSuggest.js';

const MY_LIST = [
  'tomato', 'parmesan cheese', 'cheddar cheese', 'olive oil', 'garlic',
  'red onion', 'onion', 'chicken breast', 'Greek yogurt', 'potato',
];

describe('suggestIngredientNames', () => {
  it('fixes typos to the closest name in the list', () => {
    assert.equal(suggestIngredientNames('tomatos', MY_LIST)[0], 'tomato');
    assert.equal(suggestIngredientNames('parmesan chese', MY_LIST)[0], 'parmesan cheese');
    assert.equal(suggestIngredientNames('garlik', MY_LIST)[0], 'garlic');
    assert.equal(suggestIngredientNames('greek yoghurt', MY_LIST)[0], 'Greek yogurt');
  });

  it('treats plurals and word order as the same food', () => {
    assert.equal(suggestIngredientNames('Tomatoes', MY_LIST)[0], 'tomato');
    assert.equal(suggestIngredientNames('cheese, parmesan', MY_LIST)[0], 'parmesan cheese');
  });

  it('never suggests the name itself, and drops weak matches', () => {
    assert.deepEqual(suggestIngredientNames('Garlic', MY_LIST), []);
    assert.deepEqual(suggestIngredientNames('saffron', MY_LIST), []);
    assert.deepEqual(suggestIngredientNames('', MY_LIST), []);
  });

  it('caps the list and dedupes candidates', () => {
    const out = suggestIngredientNames('onoin', [...MY_LIST, 'Onion', 'onion']);
    assert.ok(out.length <= 3);
    assert.equal(out.filter(n => n.toLowerCase() === 'onion').length, 1);
  });
});

describe('nameSimilarity', () => {
  it('is 1 for the same food and low for different ones', () => {
    assert.equal(nameSimilarity('Potatoes', 'potato'), 1);
    assert.ok(nameSimilarity('potato', 'olive oil') < 0.4);
  });
});

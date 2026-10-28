import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickUsdaFood, scoreUsdaMatch } from './usdaScore.js';

const f = (description, dataType = 'SR Legacy') => ({ description, dataType });

// USDA's own top results for "salt", in its order.
const SALT = [
  f('Butter, salted'), f('Salt, table'), f('Butter, stick, salted', 'Foundation'),
  f('Butter, whipped, with salt'), f('Butter, without salt'), f('Cabbage, mustard, salted'),
  f('Fish, mackerel, salted'), f('Jellyfish, dried, salted'), f('Pumpkin, canned, with salt'),
  f('Salt, table, iodized', 'Foundation'),
];

test('salt picks a salt, not salted butter', () => {
  assert.match(pickUsdaFood(SALT, 'salt').description, /^Salt, table/);
  assert.match(pickUsdaFood(SALT, 'sea salt').description, /^Salt, table/);
  assert.match(pickUsdaFood(SALT.slice(0, 5), 'salt').description, /^Salt, table/);
});

test('every word you typed has to be there', () => {
  const foods = [f('Pumpkin, raw'), f('Spices, pumpkin pie spice')];
  assert.equal(pickUsdaFood(foods, 'pumpkin pie spice').description, 'Spices, pumpkin pie spice');
});

test('a penalty word you asked for does not count against a food', () => {
  const pie = f('Spices, pumpkin pie spice');
  assert.ok(scoreUsdaMatch(pie, 'pumpkin pie spice') < scoreUsdaMatch(pie, 'pumpkin spice'));
});

test('a lead name that is what you typed wins over the same words further in', () => {
  const foods = [f('Yogurt, Greek, strawberry, nonfat'), f('Yogurt, Greek, plain, nonfat')];
  assert.equal(pickUsdaFood(foods, 'greek yogurt plain').description, 'Yogurt, Greek, plain, nonfat');
  assert.equal(pickUsdaFood([f('Lemon peel, raw'), f('Lemons, raw, without peel')], 'lemon').description, 'Lemons, raw, without peel');
});

test('empty results', () => {
  assert.equal(pickUsdaFood([], 'salt'), null);
  assert.equal(pickUsdaFood(undefined, 'salt'), null);
});

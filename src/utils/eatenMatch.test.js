import test from 'node:test';
import assert from 'node:assert/strict';
import { eatenKey, foodWords, lookupEatenDate, trackedNameParts } from './eatenMatch.js';

// Every ingredient in this map is something that was actually logged.
const ate = (...names) => new Map(names.map(n => [eatenKey(n), '2026-07-29']));

test('foodWords normalizes plural, punctuation and word order', () => {
  assert.deepEqual(foodWords('Apple(s)_honey crisp'), ['apple', 'crisp', 'honey']);
  assert.deepEqual(foodWords('red grapes'), foodWords('Grapes, Red'));
  assert.deepEqual(foodWords('hummus'), ['hummus']); // -us must not lose its s
});

test('trackedNameParts splits base from qualifier on the underscore', () => {
  const { base, full } = trackedNameParts('rice cake(s)_white cheddar');
  assert.deepEqual(base, ['cake', 'rice']);
  assert.deepEqual(full, ['cake', 'cheddar', 'rice', 'white']);
});

test('a logged ingredient matching the food itself counts', () => {
  assert.equal(lookupEatenDate('pistachios', ate('pistachio')), '2026-07-29');
  assert.equal(lookupEatenDate('pickle(s)', ate('pickles')), '2026-07-29');
  assert.equal(lookupEatenDate('bell pepper(s)', ate('bell peppers')), '2026-07-29');
});

test('the qualifier may sit on either side', () => {
  // Tracked carries it, log doesn't.
  assert.equal(lookupEatenDate('rice cake(s)_white cheddar', ate('rice cakes')), '2026-07-29');
  assert.equal(lookupEatenDate('grapes_red', ate('grapes')), '2026-07-29');
  // Log carries it, tracked doesn't have it beyond the variant.
  assert.equal(lookupEatenDate('olive(s)_pitted black', ate('black olives')), '2026-07-29');
  assert.equal(lookupEatenDate('grapes_red', ate('red grapes')), '2026-07-29');
});

// The reported bug: a Since of 0 for food that wasn't eaten. Each of these
// matched under the old substring rule.
test('a word of the name is not the food', () => {
  assert.equal(lookupEatenDate('hummus_garlic', ate('garlic')), null);
  assert.equal(lookupEatenDate('rice cake(s)_white cheddar', ate('rice')), null);
  assert.equal(lookupEatenDate('rice cake(s)_white cheddar', ate('cheddar cheese')), null);
  assert.equal(lookupEatenDate('apple(s)_honey crisp', ate('honey')), null);
  assert.equal(lookupEatenDate('sweet potato(s)', ate('potato')), null);
});

test('one food is not another that contains its letters', () => {
  assert.equal(lookupEatenDate('watermelon', ate('melon')), null);
  assert.equal(lookupEatenDate('melon(s)', ate('watermelon')), null);
  assert.equal(lookupEatenDate('pineapple', ate('apples')), null);
  assert.equal(lookupEatenDate('pear', ate('peach')), null);
});

test('never eaten stays unknown', () => {
  assert.equal(lookupEatenDate('kefir', ate('milk', 'chicken thighs')), null);
  assert.equal(lookupEatenDate('', ate('kefir')), null);
});

test('the most recent date wins', () => {
  const map = new Map([[eatenKey('bananas'), '2026-07-01'], [eatenKey('banana'), '2026-07-20']]);
  assert.equal(lookupEatenDate('banana(s)', map), '2026-07-20');
});

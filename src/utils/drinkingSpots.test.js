import test from 'node:test';
import assert from 'node:assert/strict';
import { isDrinkingSpot, categoryKind } from './drinkingSpots.js';

test('bar-only categories are drinking spots', () => {
  for (const c of [['Dive'], ['Cocktail'], ['Brewery'], ['Beer hall'], ['Wine bar'], ['Pub'],
    ['Club'], ['Cocktail', 'Dance'], ['Cocktail', 'Rooftop bar'], ['Dance', 'Club']]) {
    assert.equal(isDrinkingSpot({ categories: c }), true, c.join('+'));
  }
});

test('a bar that is also a restaurant stays', () => {
  assert.equal(isDrinkingSpot({ categories: ['Cocktail', 'American'] }), false);
  assert.equal(isDrinkingSpot({ categories: ['Italian'], buckets: ['drinking'] }), false);
  assert.equal(isDrinkingSpot({ categories: ['Gastro Pub'] }), false);
  assert.equal(isDrinkingSpot({ categories: ['Cocktail'], buckets: ['drinking', 'lunch-dinner'] }), false);
});

test('drinking bucket alone, or with neutral categories', () => {
  assert.equal(isDrinkingSpot({ buckets: ['drinking'] }), true);
  assert.equal(isDrinkingSpot({ buckets: ['drinking'], categories: ['ambiance'] }), true);
  assert.equal(isDrinkingSpot({ buckets: ['going-out'], categories: ['Music Venue'] }), false);
});

test('untagged and food spots are never hidden', () => {
  assert.equal(isDrinkingSpot({}), false);
  assert.equal(isDrinkingSpot({ categories: ['Coffee/Tea'] }), false);
  assert.equal(isDrinkingSpot({ categories: ['Movie Theater', 'Date Spot'] }), false);
});

test('categoryKind', () => {
  assert.equal(categoryKind('Rooftop bar'), 'drink');
  assert.equal(categoryKind('Comedy Show'), 'neutral');
  assert.equal(categoryKind('Thai'), 'food');
});

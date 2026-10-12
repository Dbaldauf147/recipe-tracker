import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seasonForMonth, recipeInSeason } from './recipeSeason.js';

test('seasonForMonth maps every month', () => {
  assert.equal(seasonForMonth(10), 'fall');
  assert.equal(seasonForMonth(12), 'winter');
  assert.equal(seasonForMonth(1), 'winter');
  assert.equal(seasonForMonth(3), 'spring');
  assert.equal(seasonForMonth(7), 'summer');
});

test('recipeInSeason: year-round recipes are always in', () => {
  assert.equal(recipeInSeason({}, 1), true);
  assert.equal(recipeInSeason({ seasonOnly: '' }, 7), true);
  assert.equal(recipeInSeason({ seasonOnly: 'bogus' }, 7), true);
});

test('recipeInSeason: seasonal recipes only in their season', () => {
  assert.equal(recipeInSeason({ seasonOnly: 'fall' }, 10), true);
  assert.equal(recipeInSeason({ seasonOnly: 'fall' }, 8), false);
  assert.equal(recipeInSeason({ seasonOnly: 'winter' }, 1), true);
  assert.equal(recipeInSeason({ seasonOnly: 'winter' }, 11), false);
});

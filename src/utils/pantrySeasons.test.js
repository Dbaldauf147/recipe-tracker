import test from 'node:test';
import assert from 'node:assert/strict';
import { naturalSeasonMonths, inSeasonMonth, formatMonths, cleanMonths } from './pantrySeasons.js';

test('natural season reads the food part of a tracked name', () => {
  assert.deepEqual(naturalSeasonMonths('apple(s)_honey crisp'), [8, 9, 10, 11]);
  assert.deepEqual(naturalSeasonMonths('cherries'), [6, 7]);
  assert.deepEqual(naturalSeasonMonths('grapes_red'), [8, 9, 10]);
});

test('the longest matching food wins', () => {
  assert.deepEqual(naturalSeasonMonths('watermelon'), [7, 8, 9]);
  assert.deepEqual(naturalSeasonMonths('sweet potato(s)'), [9, 10, 11]);
  assert.deepEqual(naturalSeasonMonths('cherry tomatoes'), [7, 8, 9]);
});

test('packaged snacks have no natural season', () => {
  assert.equal(naturalSeasonMonths('trail mix'), null);
  assert.equal(naturalSeasonMonths('rice cake(s)_white cheddar'), null);
  assert.equal(naturalSeasonMonths(''), null);
});

test('inSeasonMonth: no months means all year', () => {
  assert.equal(inSeasonMonth({ ingredient: 'kefir' }, 3), true);
  assert.equal(inSeasonMonth({ ingredient: 'kefir', seasonMonths: [] }, 3), true);
  assert.equal(inSeasonMonth({ ingredient: 'peach', seasonMonths: [7, 8] }, 7), true);
  assert.equal(inSeasonMonth({ ingredient: 'peach', seasonMonths: [7, 8] }, 10), false);
});

test('formatMonths joins runs and wraps past December', () => {
  assert.equal(formatMonths([6, 7, 8]), 'Jun–Aug');
  assert.equal(formatMonths([12, 1, 2]), 'Dec–Feb');
  assert.equal(formatMonths([5, 6, 9, 10]), 'May–Jun, Sep–Oct');
  assert.equal(formatMonths([4]), 'Apr');
  assert.equal(formatMonths([]), 'All year');
  assert.equal(formatMonths([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), 'All year');
});

test('cleanMonths drops junk and sorts', () => {
  assert.deepEqual(cleanMonths([12, '3', 3, 0, 13, 'x']), [3, 12]);
  assert.deepEqual(cleanMonths(undefined), []);
});

test('the weekly auto-add skips items scheduled for other months', async () => {
  const { findTopSince } = await import('./pantryAutoAdd.js');
  const now = new Date('2026-10-09T12:00:00');
  const list = [
    { ingredient: 'peach(es)', seasonMonths: [7, 8, 9] }, // never eaten, but not October
    { ingredient: 'pear', lastPurchased: '2026-08-01T00:00:00Z' },
    { ingredient: 'apple(s)', seasonMonths: [9, 10, 11], lastPurchased: '2026-10-01T00:00:00Z' },
  ];
  assert.equal(findTopSince(list, new Map(), now)?.ingredient, 'pear');
  assert.equal(findTopSince([list[0]], new Map(), now), null);
});

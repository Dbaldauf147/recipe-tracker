import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeCompletion, isCategorized, inCategorizePopulation } from './categorizeCompletion.js';

const bucketsOf = r => (Array.isArray(r.buckets) ? r.buckets : (r.mealType ? [r.mealType] : []));
const mine = (extra) => ({ _isMine: true, ...extra });

test('counts only my non-retired spots', () => {
  const list = [
    mine({ buckets: ['coffee'], cuisines: ['Cafe'] }),
    mine({ buckets: [], cuisines: ['Thai'] }),
    mine({ buckets: ['coffee'], cuisines: ['Cafe'], frequency: 'retired' }),
    { _isMine: false, buckets: [], cuisines: [] },
  ];
  assert.deepEqual(categorizeCompletion(list, bucketsOf), { done: 1, total: 2, pct: 50 });
});

test('needs BOTH a bucket and a category', () => {
  assert.equal(isCategorized(mine({ buckets: ['coffee'], cuisines: [] }), bucketsOf), false);
  assert.equal(isCategorized(mine({ buckets: [], cuisines: ['Thai'] }), bucketsOf), false);
  assert.equal(isCategorized(mine({ mealType: 'coffee', cuisines: ['Cafe'] }), bucketsOf), true);
});

test('rounds down, so one left never reads 100%', () => {
  const list = Array.from({ length: 250 }, () => mine({ buckets: ['coffee'], cuisines: ['Cafe'] }));
  list.push(mine({}));
  const c = categorizeCompletion(list, bucketsOf);
  assert.equal(c.done, 250);
  assert.equal(c.total, 251);
  assert.equal(c.pct, 99); // 99.6 → 99
});

test('empty population is 100%', () => {
  assert.deepEqual(categorizeCompletion([], bucketsOf), { done: 0, total: 0, pct: 100 });
  assert.equal(inCategorizePopulation(null), false);
});

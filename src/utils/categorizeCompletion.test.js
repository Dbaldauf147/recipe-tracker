import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categorizeCompletion, isCategorized, inCategorizePopulation, categorizeGaps } from './categorizeCompletion.js';

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

test('categorizeGaps flags each unanswered question', () => {
  const gaps = categorizeGaps({ buckets: [], cuisines: [], status: '', frequency: '' });
  assert.deepEqual([...gaps].sort(), ['buckets', 'cuisines', 'status']);
});

test('categorizeGaps: nothing flagged once everything is answered', () => {
  const v = { buckets: ['lunch-dinner'], cuisines: ['Thai'], status: 'visited', frequency: 'regular' };
  assert.equal(categorizeGaps(v).size, 0);
});

test('categorizeGaps: frequency only for places you have been, and not when exempt', () => {
  const base = { buckets: ['lunch-dinner'], cuisines: ['Thai'], frequency: '' };
  assert.equal(categorizeGaps({ ...base, status: 'want-to-try' }).has('frequency'), false);
  assert.equal(categorizeGaps({ ...base, status: 'visited' }).has('frequency'), true);
  assert.equal(categorizeGaps({ ...base, status: 'want-to-try' }, { visited: true }).has('frequency'), true);
  assert.equal(categorizeGaps({ ...base, status: 'visited' }, { frequencyExempt: true }).has('frequency'), false);
});

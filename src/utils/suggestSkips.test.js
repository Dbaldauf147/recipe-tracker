// MIRRORED from PrepDay/src/utils/suggestSkips.test.ts — keep the two in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSuggestSkips, isSkipped, skipRecipe, pruneExpired, localDateKey,
  skipRecipeForMonth, requeueRecipe, laterDate, normalizeSuggestRequeues,
} from './suggestSkips.js';

const NOW = new Date(2026, 8, 27, 15, 0); // Sep 27 2026, local

test('junk field normalizes to no skips', () => {
  for (const bad of [null, undefined, 'x', 3, ['a'], { a: 5 }, { a: 'soon' }]) {
    assert.deepEqual(normalizeSuggestSkips(bad), {});
  }
  assert.deepEqual(normalizeSuggestSkips({ a: '2026-10-04', b: 1 }), { a: '2026-10-04' });
});

test('skipping hides the recipe for 7 days, then it returns', () => {
  const skips = skipRecipe({}, 'r1', NOW);
  assert.deepEqual(skips, { r1: '2026-10-04' });
  assert.equal(isSkipped(skips, 'r1', NOW), true);
  assert.equal(isSkipped(skips, 'r1', new Date(2026, 9, 3, 23, 59)), true);
  assert.equal(isSkipped(skips, 'r1', new Date(2026, 9, 4, 0, 1)), false);
  assert.equal(isSkipped(skips, 'other', NOW), false);
});

test('skip crosses month/year boundaries', () => {
  assert.deepEqual(skipRecipe({}, 'r', new Date(2026, 11, 29)), { r: '2027-01-05' });
});

test('skipping prunes expired entries', () => {
  const skips = { old: '2026-09-01', keep: '2026-10-01' };
  assert.deepEqual(pruneExpired(skips, NOW), { keep: '2026-10-01' });
  assert.deepEqual(skipRecipe(skips, 'r', NOW), { keep: '2026-10-01', r: '2026-10-04' });
});

test('localDateKey pads', () => {
  assert.equal(localDateKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('a month skip lands on the same day next month', () => {
  assert.deepEqual(skipRecipeForMonth({}, 'r', NOW), { r: '2026-10-27' });
  assert.equal(isSkipped(skipRecipeForMonth({}, 'r', NOW), 'r', new Date(2026, 9, 26, 23, 0)), true);
  assert.equal(isSkipped(skipRecipeForMonth({}, 'r', NOW), 'r', new Date(2026, 9, 27, 0, 1)), false);
});

test('a month skip clamps to a shorter month and crosses the year', () => {
  assert.deepEqual(skipRecipeForMonth({}, 'r', new Date(2027, 0, 31)), { r: '2027-02-28' });
  assert.deepEqual(skipRecipeForMonth({}, 'r', new Date(2026, 11, 15)), { r: '2027-01-15' });
});

test('back of the line records today, and the later date always wins', () => {
  assert.deepEqual(requeueRecipe({ a: '2026-01-01' }, 'r', NOW), { a: '2026-01-01', r: '2026-09-27' });
  assert.deepEqual(normalizeSuggestRequeues({ r: '2026-09-27', bad: 3 }), { r: '2026-09-27' });
  assert.equal(laterDate(null, '2026-09-27'), '2026-09-27');
  assert.equal(laterDate('2026-09-30', '2026-09-27'), '2026-09-30', 'eaten since → the real date');
  assert.equal(laterDate('2026-01-01', '2026-09-27'), '2026-09-27');
  assert.equal(laterDate(null, null), null);
});

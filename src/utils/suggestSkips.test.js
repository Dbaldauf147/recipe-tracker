// MIRRORED from PrepDay/src/utils/suggestSkips.test.ts — keep the two in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSuggestSkips, isSkipped, skipRecipe, pruneExpired, localDateKey } from './suggestSkips.js';

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

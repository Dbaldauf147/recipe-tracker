import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoriesForBuckets } from './bucketCategorySuggestions.js';

const opts = { bucketsOf: r => r.buckets || [], categoriesOf: r => r.cuisines || [] };
const spots = [
  { id: 1, buckets: ['coffee'], cuisines: ['Coffee shop', 'Bakery'] },
  { id: 2, buckets: ['coffee'], cuisines: ['coffee shop'] },
  { id: 3, buckets: ['coffee', 'breakfast'], cuisines: ['Bagels'] },
  { id: 4, buckets: ['lunch-dinner'], cuisines: ['Thai', 'Bakery'] },
];

test('ranks categories used in the bucket, most used first', () => {
  assert.deepEqual(categoriesForBuckets(spots, ['coffee'], opts).map(s => [s.name, s.count]),
    [['Coffee shop', 2], ['Bagels', 1], ['Bakery', 1]]);
});

test('no buckets → no suggestions', () => {
  assert.deepEqual(categoriesForBuckets(spots, [], opts), []);
});

test('several buckets: a spot in both counts once', () => {
  const names = categoriesForBuckets(spots, ['coffee', 'breakfast'], opts).map(s => s.name);
  assert.deepEqual(names, ['Coffee shop', 'Bagels', 'Bakery']);
  assert.equal(categoriesForBuckets(spots, ['coffee', 'breakfast'], opts).find(s => s.name === 'Bagels').count, 1);
});

test('already-chosen categories (any case) and the spot itself are left out', () => {
  const names = categoriesForBuckets(spots, ['coffee'], { ...opts, exclude: ['COFFEE SHOP'], skipId: 3 }).map(s => s.name);
  assert.deepEqual(names, ['Bakery']);
});

test('limit caps the list', () => {
  assert.equal(categoriesForBuckets(spots, ['coffee'], { ...opts, limit: 1 }).length, 1);
});

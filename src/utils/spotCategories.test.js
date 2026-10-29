import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spotCategories, withMergedCategories, mergeCategoryLists, groupSpotsByCategory } from './spotCategories.js';

test('spotCategories puts cuisines first, then old categories', () => {
  assert.deepEqual(spotCategories({ cuisines: ['Thai', 'Noodles'], categories: ['Date night'] }), ['Thai', 'Noodles', 'Date night']);
});

test('spotCategories dedupes case-insensitively and keeps the first spelling', () => {
  assert.deepEqual(spotCategories({ cuisines: ['Pizza', 'coffee'], categories: ['pizza', 'Coffee', 'Bar'] }), ['Pizza', 'coffee', 'Bar']);
});

test('spotCategories trims and drops empty / non-string values', () => {
  assert.deepEqual(spotCategories({ cuisines: ['  Sushi ', '', '   ', null], categories: ['sushi', 5, 'Ramen '] }), ['Sushi', 'Ramen']);
});

test('spotCategories handles missing fields and missing spot', () => {
  assert.deepEqual(spotCategories({}), []);
  assert.deepEqual(spotCategories({ categories: ['Bar'] }), ['Bar']);
  assert.deepEqual(spotCategories({ cuisines: ['Bar'] }), ['Bar']);
  assert.deepEqual(spotCategories({ cuisines: 'Bar' }), []);
  assert.deepEqual(spotCategories(null), []);
});

test('withMergedCategories moves everything into cuisines and clears categories', () => {
  const r = { id: 'a', name: 'X', cuisines: ['Thai'], categories: ['thai', 'Lunch'] };
  assert.deepEqual(withMergedCategories(r), { id: 'a', name: 'X', cuisines: ['Thai', 'Lunch'], categories: [] });
  // input untouched
  assert.deepEqual(r.categories, ['thai', 'Lunch']);
  assert.deepEqual(withMergedCategories({ id: 'b' }), { id: 'b', cuisines: [], categories: [] });
});

test('mergeCategoryLists dedupes two master lists', () => {
  assert.deepEqual(mergeCategoryLists(['Thai', 'Pizza'], ['pizza', 'Brunch', '']), ['Thai', 'Pizza', 'Brunch']);
  assert.deepEqual(mergeCategoryLists(null, ['Bar']), ['Bar']);
  assert.deepEqual(mergeCategoryLists(undefined, undefined), []);
});

test('groupSpotsByCategory puts a spot under each of its categories, biggest group first', () => {
  const a = { id: 'a', cuisines: ['Italian', 'Pizza'] };
  const b = { id: 'b', cuisines: ['pizza'] };
  const c = { id: 'c', cuisines: [] };
  const { groups, uncategorized } = groupSpotsByCategory([a, b, c]);
  assert.deepEqual(groups.map(g => [g.label, g.spots.map(s => s.id)]), [['Pizza', ['a', 'b']], ['Italian', ['a']]]);
  assert.deepEqual(uncategorized.map(s => s.id), ['c']);
});

test('groupSpotsByCategory keeps input order inside a group and honours namesOf/labelOf', () => {
  const spots = [{ id: 'x', cuisines: ['drinking', 'Bar'] }, { id: 'y', cuisines: ['lunch-dinner'] }];
  const namesOf = r => r.cuisines.filter(c => c !== 'lunch-dinner');
  const labelOf = n => (n === 'drinking' ? 'Drinking' : n);
  const { groups, uncategorized } = groupSpotsByCategory(spots, namesOf, labelOf);
  assert.deepEqual(groups.map(g => g.label), ['Bar', 'Drinking']);
  assert.deepEqual(uncategorized.map(s => s.id), ['y']);
});

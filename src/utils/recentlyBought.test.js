import test from 'node:test';
import assert from 'node:assert/strict';
import { recentlyBoughtRecipes, formatBoughtDate } from './recentlyBought.js';

const recipes = [
  { id: 'a', title: 'Chili' },
  { id: 'b', title: 'Bowl' },
  { id: 'c', title: 'Soup' },
  { id: 'd', title: 'Empty', ingredients: [] },
];
const history = [
  { date: '2026-09-01', recipeIds: ['a', 'b'] },
  { date: '2026-10-01', recipeIds: ['b', 'gone'] },
  { date: '2026-09-15', recipeIds: ['c', 'c', 'd'] },
];

test('newest shop first, each recipe once at its latest date', () => {
  const out = recentlyBoughtRecipes(history, recipes);
  assert.deepEqual(out.map(x => [x.recipe.id, x.date, x.times]), [
    ['b', '2026-10-01', 2],
    // Same day → by title: "Empty" before "Soup".
    ['d', '2026-09-15', 1],
    ['c', '2026-09-15', 1],
    ['a', '2026-09-01', 1],
  ]);
});

test('deleted recipes are skipped, include filters, limit caps', () => {
  const out = recentlyBoughtRecipes(history, recipes, { limit: 2, include: r => r.id !== 'd' });
  assert.deepEqual(out.map(x => x.recipe.id), ['b', 'c']);
});

test('bad history is empty, not a crash', () => {
  assert.deepEqual(recentlyBoughtRecipes(null, recipes), []);
  assert.deepEqual(recentlyBoughtRecipes([{ recipeIds: ['a'] }], recipes), []);
});

test('formatBoughtDate', () => {
  assert.equal(formatBoughtDate('2026-10-06'), 'Oct 6');
  assert.equal(formatBoughtDate('2026-10-06T12:00:00Z'), 'Oct 6');
  assert.equal(formatBoughtDate('nope'), '');
});

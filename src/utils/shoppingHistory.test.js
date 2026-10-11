import test from 'node:test';
import assert from 'node:assert/strict';
import { lastShoppingListExtras, shoppingListWeeks, isShoppingListEntry } from './shoppingHistory.js';
import { findTopSince } from './pantryAutoAdd.js';

const HISTORY = [
  { date: '2026-09-27', recipeIds: ['r1'], extras: ['kiwi(s)', 'trail mix'], timestamp: '2026-09-27T20:00:00Z' },
  { date: '2026-10-04', recipeIds: ['r1', 'r2'], extras: ['apple(s)_honey crisp', 'venison sticks'], timestamp: '2026-10-04T20:00:00Z' },
  // A Week Plan fill-in: meals eaten, not a list shopped.
  { date: '2026-10-10', recipeIds: ['r2'], source: 'week-plan', timestamp: '2026-10-10T23:59:59.000Z' },
];

test('Week Plan fill-ins are not shopping lists', () => {
  assert.equal(isShoppingListEntry(HISTORY[2]), false);
  assert.equal(isShoppingListEntry(HISTORY[0]), true);
});

test('the last list is the newest Reset within two weeks', () => {
  assert.deepEqual(lastShoppingListExtras(HISTORY, '2026-10-11'), ['apple(s)_honey crisp', 'venison sticks']);
  // Same-day resets both count.
  const twice = [...HISTORY, { date: '2026-10-04', extras: ['mango(s)'] }];
  assert.deepEqual(lastShoppingListExtras(twice, '2026-10-11').sort(), ['apple(s)_honey crisp', 'mango(s)', 'venison sticks']);
  // Too old to be "last week's".
  assert.deepEqual(lastShoppingListExtras(HISTORY, '2026-11-20'), []);
  assert.deepEqual(lastShoppingListExtras([], '2026-10-11'), []);
});

test("the auto-add never repeats last list's snack or fruit", () => {
  const fruit = [
    { ingredient: 'apple(s)_honey crisp' }, // never eaten: would win, but was on last week's list
    { ingredient: 'pear', lastPurchased: '2026-08-01T00:00:00Z' },
  ];
  const now = new Date('2026-10-11T12:00:00');
  assert.equal(findTopSince(fruit, new Map(), now)?.ingredient, 'apple(s)_honey crisp');
  const skip = lastShoppingListExtras(HISTORY, '2026-10-11');
  assert.equal(findTopSince(fruit, new Map(), now, skip)?.ingredient, 'pear');
  // Nothing else to pick → no pick, rather than a repeat.
  assert.equal(findTopSince([fruit[0]], new Map(), now, skip), null);
});

test('shoppingListWeeks spells out each list, newest first', () => {
  const recipes = {
    r1: { title: 'Chili', ingredients: [{ ingredient: 'Black beans' }, { ingredient: 'onion' }] },
    r2: { title: 'Stir fry', ingredients: [{ ingredient: 'onion' }, { ingredient: 'Broccoli' }, { ingredient: 'onion' }] },
  };
  const weeks = shoppingListWeeks(HISTORY, id => recipes[id] || null);
  assert.deepEqual(weeks.map(w => w.date), ['2026-10-04', '2026-09-27']);
  assert.deepEqual(weeks[0].ingredients, [
    { name: 'Black beans', count: 1 }, { name: 'Broccoli', count: 1 }, { name: 'onion', count: 2 },
  ]);
  assert.deepEqual(weeks[0].extras, ['apple(s)_honey crisp', 'venison sticks']);
  assert.deepEqual(weeks[0].recipes.map(r => r.title), ['Chili', 'Stir fry']);
});

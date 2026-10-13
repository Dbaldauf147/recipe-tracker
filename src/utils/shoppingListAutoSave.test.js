import test from 'node:test';
import assert from 'node:assert/strict';
import { autoSaveShoppingList, appendResetEntry } from './shoppingListAutoSave.js';
import { shoppingListWeeks, lastShoppingListExtras } from './shoppingHistory.js';

const NOW = '2026-10-14T12:00:00.000Z';
const log = (recipeId, extra = {}) => ({ entries: [{ type: 'recipe', recipeId, mealSlot: 'lunch', ...extra }] });

test('nothing saved before a recipe is logged or has sat 3 days', () => {
  const r = autoSaveShoppingList({ plan: ['a', 'b'], since: { a: '2026-10-12', b: '2026-10-13' }, history: [], dailyLog: {}, today: '2026-10-14', nowIso: NOW });
  assert.equal(r.history, null);
  assert.deepEqual(r.since, { a: '2026-10-12', b: '2026-10-13' });
});

test('a logged meal saves the whole list, with its extras', () => {
  const r = autoSaveShoppingList({
    plan: ['a', 'b'], since: { a: '2026-10-13', b: '2026-10-13' }, history: [],
    dailyLog: { '2026-10-14': log('a') }, extras: ['kiwi(s)', ' '], today: '2026-10-14', nowIso: NOW,
  });
  assert.equal(r.history.length, 1);
  assert.deepEqual(r.history[0], { date: '2026-10-13', recipeIds: ['a', 'b'], timestamp: NOW, savedOn: '2026-10-14', source: 'auto-list', extras: ['kiwi(s)'] });
});

test('a Prepare-table suggestion is not a logged meal', () => {
  const r = autoSaveShoppingList({
    plan: ['a'], since: { a: '2026-10-13' }, history: [],
    dailyLog: { '2026-10-14': log('a', { autoSuggested: true }) }, today: '2026-10-14', nowIso: NOW,
  });
  assert.equal(r.history, null);
});

test('3 days on the list saves it', () => {
  const r = autoSaveShoppingList({ plan: ['a'], since: { a: '2026-10-11' }, history: [], today: '2026-10-14', nowIso: NOW });
  assert.deepEqual(r.history[0].recipeIds, ['a']);
  assert.equal(r.history[0].date, '2026-10-11');
});

test('a recipe first seen here is backdated to its earliest logged meal this week', () => {
  const r = autoSaveShoppingList({
    plan: ['a'], since: {}, history: [],
    dailyLog: { '2026-10-11': log('a'), '2026-10-12': log('a'), '2026-09-01': log('a') }, today: '2026-10-14', nowIso: NOW,
  });
  assert.equal(r.since.a, '2026-10-11');
  assert.equal(r.history[0].date, '2026-10-11');
});

test('removed recipes drop out of since', () => {
  const r = autoSaveShoppingList({ plan: ['b'], since: { a: '2026-10-01', b: '2026-10-14' }, history: [], today: '2026-10-14', nowIso: NOW });
  assert.deepEqual(r.since, { b: '2026-10-14' });
});

test('recipes added during the trip join the open auto-saved list', () => {
  const history = [{ date: '2026-10-11', recipeIds: ['a'], timestamp: 't', savedOn: '2026-10-12', source: 'auto-list', extras: ['kiwi(s)'] }];
  const r = autoSaveShoppingList({
    plan: ['a', 'c'], since: { a: '2026-10-11', c: '2026-10-14' }, history,
    dailyLog: { '2026-10-14': log('c') }, extras: ['nuts'], today: '2026-10-14', nowIso: NOW,
  });
  assert.equal(r.history.length, 1);
  assert.deepEqual(r.history[0].recipeIds, ['a', 'c']);
  assert.deepEqual(r.history[0].extras, ['kiwi(s)', 'nuts']);
  assert.equal(r.history[0].savedOn, '2026-10-14');
});

test('already-saved recipes (still on the list) do not re-save', () => {
  const history = [{ date: '2026-10-11', recipeIds: ['a'], timestamp: 't', savedOn: '2026-10-12', source: 'auto-list' }];
  const r = autoSaveShoppingList({ plan: ['a'], since: { a: '2026-10-11' }, history, dailyLog: { '2026-10-14': log('a') }, today: '2026-10-14', nowIso: NOW });
  assert.equal(r.history, null);
});

test('leftovers eaten after Reset do not start a new list', () => {
  const history = [{ date: '2026-10-12', recipeIds: ['a', 'b'], timestamp: 't' }];
  const r = autoSaveShoppingList({
    plan: ['a', 'b'], since: { a: '2026-10-08', b: '2026-10-08' }, history,
    dailyLog: { '2026-10-14': log('a') }, today: '2026-10-14', nowIso: NOW,
  });
  assert.equal(r.history, null);
});

test('after the 7-day trip a new list starts', () => {
  const history = [{ date: '2026-10-01', recipeIds: ['a'], timestamp: 't', savedOn: '2026-10-02', source: 'auto-list' }];
  const r = autoSaveShoppingList({
    plan: ['a', 'd'], since: { a: '2026-10-01', d: '2026-10-12' }, history,
    dailyLog: { '2026-10-13': log('d') }, today: '2026-10-14', nowIso: NOW,
  });
  assert.equal(r.history.length, 2);
  assert.deepEqual(r.history[1].recipeIds, ['d']);
  assert.equal(r.history[1].date, '2026-10-12');
});

test('Reset folds this trip\'s auto-saved list into its own entry', () => {
  const history = [
    { date: '2026-10-04', recipeIds: ['z'], timestamp: 'old' },
    { date: '2026-10-11', recipeIds: ['a', 'b'], timestamp: 't', source: 'auto-list', extras: ['kiwi(s)'] },
  ];
  const next = appendResetEntry(history, { date: '2026-10-14', recipeIds: ['b', 'c'], timestamp: NOW, extras: ['nuts'] }, '2026-10-14');
  assert.equal(next.length, 2);
  assert.deepEqual(next[1], { date: '2026-10-14', recipeIds: ['a', 'b', 'c'], timestamp: NOW, extras: ['kiwi(s)', 'nuts'] });
  // No open auto list → plain append.
  assert.equal(appendResetEntry(history.slice(0, 1), { date: '2026-10-14', recipeIds: ['c'] }, '2026-10-14').length, 2);
});

test('Shopping Lists tab: weeks with no saved list are rebuilt; logged meals are marked', () => {
  const history = [
    { date: '2026-09-27', weekStart: '2026-09-27', recipeIds: ['a'], source: 'week-plan', timestamp: '2026-10-03T23:59:59.000Z' },
    { date: '2026-10-05', weekStart: '2026-10-04', recipeIds: ['b'], source: 'week-plan', timestamp: 'w2' },
    { date: '2026-10-06', recipeIds: ['b', 'c'], timestamp: 'x', source: 'auto-list' },
  ];
  const getRecipe = id => ({ id, title: id.toUpperCase(), ingredients: [] });
  const dailyLog = { '2026-09-28': log('a'), '2026-10-07': log('b'), '2026-10-08': log('b') };
  const weeks = shoppingListWeeks(history, getRecipe, { dailyLog, today: '2026-10-14' });
  assert.deepEqual(weeks.map(w => [w.date, w.kind]), [['2026-10-06', 'auto'], ['2026-09-27', 'rebuilt']]);
  assert.deepEqual(weeks[0].recipes.map(r => [r.id, r.logged]), [['b', 2], ['c', 0]]);
  assert.equal(weeks[1].recipes[0].logged, 1);
});

test('a rebuilt week leaves off meals a nearby saved list already holds', () => {
  const history = [
    { date: '2026-10-04', weekStart: '2026-10-04', recipeIds: ['a', 'b', 'c'], source: 'week-plan', timestamp: 'w' },
    { date: '2026-10-07', recipeIds: ['c', 'd'], timestamp: 'x', source: 'auto-list' },
    { date: '2026-09-27', weekStart: '2026-09-27', recipeIds: ['d'], source: 'week-plan', timestamp: 'v' },
  ];
  const weeks = shoppingListWeeks(history, id => ({ id, title: id, ingredients: [] }));
  const rebuilt = weeks.filter(w => w.kind === 'rebuilt');
  assert.deepEqual(rebuilt.map(w => [w.date, w.recipes.map(r => r.id)]), [['2026-10-04', ['a', 'b']], ['2026-09-27', ['d']]]); // a list AFTER the week doesn't cover it
});

test('auto snack/fruit picks save with the list, and are frozen after', () => {
  const r = autoSaveShoppingList({
    plan: ['a'], since: { a: '2026-10-11' }, history: [], extras: ['coffee'], autoPicks: ['trail mix', 'kiwi(s)'],
    today: '2026-10-14', nowIso: NOW,
  });
  assert.deepEqual(r.history[0].extras, ['coffee', 'trail mix', 'kiwi(s)']);
  assert.deepEqual(r.history[0].autoPicks, ['trail mix', 'kiwi(s)']);
  // You ate the trail mix, so the pick drifts to almonds — not a second purchase.
  const r2 = autoSaveShoppingList({
    plan: ['a', 'b'], since: { a: '2026-10-11', b: '2026-10-11' }, history: r.history, extras: ['coffee'], autoPicks: ['almonds', 'kiwi(s)'],
    today: '2026-10-15', nowIso: NOW,
  });
  assert.deepEqual(r2.history[0].recipeIds, ['a', 'b']);
  assert.deepEqual(r2.history[0].extras, ['coffee', 'trail mix', 'kiwi(s)']);
});

test('Reset keeps the frozen picks, not a drifted one', () => {
  const history = [{ date: '2026-10-11', recipeIds: ['a'], timestamp: 't', source: 'auto-list', extras: ['coffee', 'trail mix'], autoPicks: ['trail mix'] }];
  const next = appendResetEntry(history, { date: '2026-10-14', recipeIds: ['a'], extras: ['coffee', 'almonds', 'nuts'], autoPicks: ['almonds'] }, '2026-10-14');
  assert.deepEqual(next[0].extras, ['coffee', 'trail mix', 'nuts']);
  assert.deepEqual(next[0].autoPicks, ['trail mix']);
});

test("this week's auto-saved list is not \"last week's\" for the no-repeat rule", () => {
  const history = [
    { date: '2026-10-04', recipeIds: ['z'], extras: ['apple(s)'], timestamp: 'r' },
    { date: '2026-10-11', recipeIds: ['a'], extras: ['trail mix'], autoPicks: ['trail mix'], timestamp: 't', source: 'auto-list' },
  ];
  assert.deepEqual(lastShoppingListExtras(history, '2026-10-14'), ['apple(s)']);
  // A week on, it's closed — and becomes last week's list.
  assert.deepEqual(lastShoppingListExtras(history, '2026-10-18'), ['trail mix']);
  const weeks = shoppingListWeeks(history, id => ({ id, title: id, ingredients: [] }), { today: '2026-10-14' });
  assert.deepEqual(weeks.map(w => [w.date, w.current]), [['2026-10-11', true], ['2026-10-04', false]]);
});

test('meals already on a list from the last 10 days do not start another', () => {
  // Reset on the 12th; the same two meals got a fresh on-the-list date on the 13th.
  const history = [{ date: '2026-10-12', recipeIds: ['a', 'b', 'c'], timestamp: 't' }];
  const r = autoSaveShoppingList({
    plan: ['a', 'b'], since: { a: '2026-10-13', b: '2026-10-13' }, history,
    dailyLog: { '2026-10-13': log('a') }, today: '2026-10-13', nowIso: NOW,
  });
  assert.equal(r.history, null);
  // 10+ days later the same meal is a new shop.
  const later = autoSaveShoppingList({
    plan: ['a'], since: { a: '2026-10-22' }, history,
    dailyLog: { '2026-10-22': log('a') }, today: '2026-10-22', nowIso: NOW,
  });
  assert.deepEqual(later.history[1].recipeIds, ['a']);
  // One new meal alongside them is a real new list, repeats included.
  const mixed = autoSaveShoppingList({
    plan: ['a', 'z'], since: { a: '2026-10-13', z: '2026-10-13' }, history,
    dailyLog: { '2026-10-13': log('z') }, today: '2026-10-13', nowIso: NOW,
  });
  assert.deepEqual(mixed.history[1].recipeIds, ['a', 'z']);
});

test('Shopping Lists tab: the same meals within 10 days are shown once', () => {
  const history = [
    { date: '2026-10-12', recipeIds: ['a', 'b', 'c', 'd'], extras: ['coffee', 'melon(s)'], timestamp: '2026-10-12T12:00:00Z' },
    // The duplicate auto-save: nothing new but this week's picks.
    { date: '2026-10-13', recipeIds: ['b', 'c'], extras: ['orange(s)'], autoPicks: ['orange(s)'], timestamp: '2026-10-13T11:00:00Z', source: 'auto-list', savedOn: '2026-10-13' },
    // One new meal: a real list, shown whole.
    { date: '2026-10-15', recipeIds: ['a', 'e'], timestamp: '2026-10-15T11:00:00Z' },
    // Outside 10 days of the 12th's list (and the 15th's doesn't hold b).
    { date: '2026-10-23', recipeIds: ['b'], timestamp: '2026-10-23T11:00:00Z' },
  ];
  const weeks = shoppingListWeeks(history, id => ({ id, title: id, ingredients: [] }), { today: '2026-10-24' });
  assert.deepEqual(weeks.map(w => [w.date, w.recipes.map(r => r.id)]), [
    ['2026-10-23', ['b']],
    ['2026-10-15', ['a', 'e']],
    ['2026-10-12', ['a', 'b', 'c', 'd']],
  ]);
  assert.deepEqual(weeks[2].extras, ['coffee', 'melon(s)', 'orange(s)']);
  // Stored history is untouched.
  assert.deepEqual(history[1].recipeIds, ['b', 'c']);
});

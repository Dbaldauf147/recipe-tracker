import test from 'node:test';
import assert from 'node:assert/strict';
import { autoSaveShoppingList, appendResetEntry } from './shoppingListAutoSave.js';
import { shoppingListWeeks } from './shoppingHistory.js';

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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SUB_ITEMS, subItemGroupKey, sanitizeSubItemLists, addSubItem, removeSubItem,
  cleanSubScores, deriveCategoryScore, subScoreSummary, subItemRows,
  applySubScore,
} from './ratingSubItems.js';

test('group: a category is grouped by its label', () => {
  assert.equal(subItemGroupKey('Food & Drink Quality'), 'food-drink-quality');
  assert.equal(subItemGroupKey(' Service '), 'service');
  assert.equal(subItemGroupKey('★'), 'rating');
});

test('lists: malformed rows, duplicates and empty groups are dropped', () => {
  assert.deepEqual(sanitizeSubItemLists({
    food: [{ key: 'burger', label: ' Burger ' }, { key: 'burger', label: 'Again' }, { key: '', label: 'x' }, null, { key: 'fries' }],
    service: [],
    price: 'nope',
  }), { food: [{ key: 'burger', label: 'Burger' }] });
  assert.deepEqual(sanitizeSubItemLists(null), {});
  assert.deepEqual(sanitizeSubItemLists([1, 2]), {});
});

test('add: appends, refuses blanks, repeats and a full list', () => {
  let r = addSubItem({}, 'food', '  Main   course ');
  assert.deepEqual(r, { lists: { food: [{ key: 'main-course', label: 'Main course' }] }, key: 'main-course', error: null });
  const again = addSubItem(r.lists, 'food', 'main COURSE');
  assert.equal(again.key, null);
  assert.match(again.error, /already on the list/);
  assert.deepEqual(again.lists, r.lists);
  assert.match(addSubItem(r.lists, 'food', '   ').error, /Type a name/);
  // another group is its own list
  r = addSubItem(r.lists, 'service', 'Main course');
  assert.deepEqual(Object.keys(r.lists), ['food', 'service']);
  let full = {};
  for (let i = 0; i < MAX_SUB_ITEMS; i++) full = addSubItem(full, 'food', `Item ${i}`).lists;
  assert.equal(full.food.length, MAX_SUB_ITEMS);
  assert.match(addSubItem(full, 'food', 'One more').error, /limit/);
});

test('remove: takes one off, and an emptied group disappears', () => {
  const lists = { food: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] };
  assert.deepEqual(removeSubItem(lists, 'food', 'a'), { food: [{ key: 'b', label: 'B' }] });
  assert.deepEqual(removeSubItem({ food: [{ key: 'a', label: 'A' }] }, 'food', 'a'), {});
  assert.deepEqual(removeSubItem(lists, 'nope', 'a'), lists);
});

test('sub-scores: only 1–5 survive, empty categories go', () => {
  assert.deepEqual(cleanSubScores({ food: { a: 4, b: null, c: 0, d: 6, e: '3', f: 2.6 }, service: { x: null }, '': { y: 3 } }),
    { food: { a: 4, f: 3 } });
  assert.deepEqual(cleanSubScores(undefined), {});
});

test('derive: the average, rounded to a whole star', () => {
  assert.equal(deriveCategoryScore({ a: 5, b: 4 }), 5);      // 4.5 rounds up
  assert.equal(deriveCategoryScore({ a: 5, b: 4, c: 4 }), 4); // 4.33
  assert.equal(deriveCategoryScore({ a: 1, b: 2 }), 2);      // 1.5 rounds up
  assert.equal(deriveCategoryScore({ a: 3 }), 3);
  assert.equal(deriveCategoryScore({ a: null }), null);
  assert.equal(deriveCategoryScore({}), null);
  assert.equal(deriveCategoryScore(undefined), null);
  assert.deepEqual(subScoreSummary({ a: 5, b: 4, c: 4, d: null }), { count: 3, average: 13 / 3 });
  assert.deepEqual(subScoreSummary({}), { count: 0, average: null });
});

test('rows: the standard list, then rated items that left it', () => {
  const lists = { food: [{ key: 'burger', label: 'Burger' }, { key: 'fries', label: 'Fries' }] };
  assert.deepEqual(subItemRows(lists, 'food', { fries: 4, 'side-salad': 2, gone: null }), [
    { key: 'burger', label: 'Burger', removed: false },
    { key: 'fries', label: 'Fries', removed: false },
    { key: 'side-salad', label: 'Side salad', removed: true },
  ]);
  assert.deepEqual(subItemRows({}, 'food', {}), []);
});

test('apply: a sub-item drives its category and leaves the others alone', () => {
  let s = { scores: { food: 2, service: 5 }, subScores: {} };
  s = applySubScore(s.scores, s.subScores, 'food', 'burger', 5);
  assert.deepEqual(s, { scores: { food: 5, service: 5 }, subScores: { food: { burger: 5 } } });
  s = applySubScore(s.scores, s.subScores, 'food', 'fries', 2);
  assert.deepEqual(s.scores, { food: 4, service: 5 }); // 3.5 rounds up
  s = applySubScore(s.scores, s.subScores, 'food', 'burger', null);
  assert.deepEqual(s, { scores: { food: 2, service: 5 }, subScores: { food: { fries: 2 } } });
  // clearing the last one clears the category
  s = applySubScore(s.scores, s.subScores, 'food', 'fries', null);
  assert.deepEqual(s, { scores: { food: null, service: 5 }, subScores: {} });
});

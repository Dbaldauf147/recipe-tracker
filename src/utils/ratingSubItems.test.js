import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SUB_ITEMS, subItemGroupKey, sanitizeSubItemLists, addSubItem, removeSubItem,
  cleanSubScores, deriveCategoryScore, subScoreSummary, subItemRows,
  applySubScore, sanitizeLevels, levelLabel, setSubItemLevels,
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

test('levels: five names, blanks allowed, none at all means stars', () => {
  assert.deepEqual(sanitizeLevels([' 8 oz ', '12  oz', '', '20 oz', '24 oz', 'extra']), ['8 oz', '12 oz', '', '20 oz', '24 oz']);
  assert.deepEqual(sanitizeLevels(['Small']), ['Small', '', '', '', '']);
  assert.equal(sanitizeLevels(['', ' ', '', '', '']), null);
  assert.equal(sanitizeLevels(undefined), null);
  assert.equal(sanitizeLevels('8 oz'), null);
  assert.equal(sanitizeLevels([1, 2, 3, 4, 5]), null);
  assert.equal(sanitizeLevels(['x'.repeat(60)])[0].length, 24);
});

test('levels: a step is called by its name, else its number', () => {
  const item = { key: 'cup', label: 'Cup size', levels: ['8 oz', '12 oz', '', '20 oz', '24 oz'] };
  assert.equal(levelLabel(item, 1), '8 oz');
  assert.equal(levelLabel(item, 3), '3');
  assert.equal(levelLabel(item, 5), '24 oz');
  assert.equal(levelLabel({ key: 'a', label: 'A' }, 4), '4');
});

test('levels: set on one item, kept through sanitising, cleared back to stars', () => {
  const lists = { coffee: [{ key: 'cup-size', label: 'Cup size' }, { key: 'crema', label: 'Crema' }] };
  const named = setSubItemLevels(lists, 'coffee', 'cup-size', ['8 oz', '12 oz', '16 oz', '20 oz', '24 oz']);
  assert.deepEqual(named.coffee, [
    { key: 'cup-size', label: 'Cup size', levels: ['8 oz', '12 oz', '16 oz', '20 oz', '24 oz'] },
    { key: 'crema', label: 'Crema' },
  ]);
  assert.deepEqual(sanitizeSubItemLists(named), named);
  assert.deepEqual(subItemRows(named, 'coffee', {})[0].levels, ['8 oz', '12 oz', '16 oz', '20 oz', '24 oz']);
  // adding and removing other items leaves the names alone
  const more = addSubItem(named, 'coffee', 'Foam').lists;
  assert.equal(more.coffee[0].levels[1], '12 oz');
  assert.equal(removeSubItem(more, 'coffee', 'crema').coffee[0].levels[4], '24 oz');
  // nothing filled in → stars again
  assert.deepEqual(setSubItemLevels(named, 'coffee', 'cup-size', ['', '', '', '', '']), lists);
  // an unknown item or group changes nothing
  assert.deepEqual(setSubItemLevels(lists, 'coffee', 'nope', ['a']), lists);
  assert.deepEqual(setSubItemLevels(lists, 'tea', 'cup-size', ['a']), lists);
  // a named level is still a 1–5 score: picking the 2nd of 5 counts as 2
  assert.deepEqual(applySubScore({}, {}, 'food', 'cup-size', 2), { scores: { food: 2 }, subScores: { food: { 'cup-size': 2 } } });
});

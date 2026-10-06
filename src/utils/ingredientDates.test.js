import test from 'node:test';
import assert from 'node:assert/strict';
import { stampNewRows, sortNewestFirst, formatDateAdded } from './ingredientDates.js';

const NOW = '2026-10-06T12:00:00.000Z';
const OLD = '2026-01-01T00:00:00.000Z';

test('an appended row under a new name is stamped', () => {
  const prev = [{ ingredient: 'Oats' }];
  const out = stampNewRows(prev, [{ ingredient: 'Oats' }, { ingredient: 'Kale' }], NOW);
  assert.equal(out[0].dateAdded, undefined);
  assert.equal(out[1].dateAdded, NOW);
});

test('a stale copy without the date gets it back by name', () => {
  const prev = [{ ingredient: 'Oats', dateAdded: OLD }];
  assert.equal(stampNewRows(prev, [{ ingredient: 'Oats' }], NOW)[0].dateAdded, OLD);
});

test('renaming an existing row in place is not an add', () => {
  const prev = [{ ingredient: 'Oats' }, { ingredient: 'Kale' }];
  const out = stampNewRows(prev, [{ ingredient: 'Rolled oats' }, { ingredient: 'Kale' }], NOW);
  assert.equal(out[0].dateAdded, undefined);
});

test('nothing stored before → nothing stamped (a fresh browser loading the DB)', () => {
  const rows = [{ ingredient: 'Oats' }];
  assert.equal(stampNewRows([], rows, NOW), rows);
  assert.equal(stampNewRows(null, rows, NOW), rows);
});

test('newest first: dated by date, then undated by reverse position', () => {
  const items = [
    { row: { ingredient: 'A' }, origIdx: 0 },
    { row: { ingredient: 'B' }, origIdx: 1 },
    { row: { ingredient: 'C', dateAdded: '2026-09-01T00:00:00Z' }, origIdx: 2 },
    { row: { ingredient: 'D', dateAdded: '2026-10-01T00:00:00Z' }, origIdx: 3 },
  ];
  assert.deepEqual(sortNewestFirst(items).map(x => x.row.ingredient), ['D', 'C', 'B', 'A']);
});

test('formatDateAdded', () => {
  assert.equal(formatDateAdded(''), '');
  assert.equal(formatDateAdded('nope'), '');
  assert.match(formatDateAdded('2026-10-06T12:00:00Z'), /^Oct \d, 2026$/);
});

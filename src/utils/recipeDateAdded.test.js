import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatDateAdded, recipeAddedDate } from './recipeDateAdded.js';

test('formats an ISO createdAt', () => {
  assert.equal(formatDateAdded('2026-11-06T15:00:00.000Z', 'en-US'), 'Added Nov 6, 2026');
});

test('accepts millisecond numbers and Firestore timestamps', () => {
  const ms = Date.UTC(2025, 0, 15, 12);
  assert.equal(formatDateAdded(ms, 'en-US'), 'Added Jan 15, 2025');
  assert.equal(formatDateAdded({ seconds: ms / 1000 }, 'en-US'), 'Added Jan 15, 2025');
  assert.equal(formatDateAdded({ toDate: () => new Date(ms) }, 'en-US'), 'Added Jan 15, 2025');
});

test('no label when there is no usable date', () => {
  for (const v of [undefined, null, '', 'not a date', {}]) {
    assert.equal(formatDateAdded(v), '');
    assert.equal(recipeAddedDate(v), null);
  }
});

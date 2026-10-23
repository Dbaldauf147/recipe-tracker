import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startQueue, moveInQueue, missingSetup } from './habitStartQueue.js';

const ns = (id, extra = {}) => ({ id, name: id, status: 'Not Started', ...extra });

test('only not-started habits, legacy spelling included', () => {
  const q = startQueue([ns('a'), { id: 'b', status: 'Most Days' }, { id: 'c', status: 'Havent Started' }]);
  assert.deepEqual(q.map(h => h.id), ['a', 'c']);
});

test('starred first, then placed by startOrder, then fallback order', () => {
  const habits = [ns('a'), ns('b', { startOrder: 1 }), ns('c', { startOrder: 0 }), ns('d', { nextUp: true }), ns('e')];
  const byName = (x, y) => y.name.localeCompare(x.name); // reverse, to prove it's used
  assert.deepEqual(startQueue(habits, byName).map(h => h.id), ['d', 'c', 'b', 'e', 'a']);
});

test('moveInQueue swaps neighbours and refuses the edges', () => {
  const q = startQueue([ns('a'), ns('b'), ns('c')]);
  assert.deepEqual(moveInQueue(q, 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveInQueue(q, 'b', 1), ['a', 'c', 'b']);
  assert.equal(moveInQueue(q, 'a', -1), null);
  assert.equal(moveInQueue(q, 'c', 1), null);
});

test('the starred habit stays pinned at #1', () => {
  const q = startQueue([ns('a'), ns('b', { nextUp: true })]);
  assert.equal(moveInQueue(q, 'a', -1), null);
  assert.equal(moveInQueue(q, 'b', 1), null);
});

test('missingSetup flags blank cadence and blank or "-" routine', () => {
  assert.deepEqual(missingSetup(ns('a')), { cadence: true, routine: true });
  assert.deepEqual(missingSetup(ns('a', { cadence: 'Daily', routine: '-' })), { cadence: false, routine: true });
  assert.deepEqual(missingSetup(ns('a', { cadence: 'Weekly', routine: 'Morning' })), { cadence: false, routine: false });
});

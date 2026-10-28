import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startQueue, dropInQueue, pinStarred, missingSetup, moveToNext, isWave2, wave2Seam } from './habitStartQueue.js';

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

test('dropInQueue moves a habit to where it was dropped', () => {
  const q = startQueue([ns('a'), ns('b'), ns('c'), ns('d')]);
  assert.deepEqual(dropInQueue(q, 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(dropInQueue(q, 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.equal(dropInQueue(q, 'b', 'b'), null);
});

test('the starred habit stays pinned at #1', () => {
  const q = startQueue([ns('a'), ns('b'), ns('s', { nextUp: true })]);
  assert.equal(dropInQueue(q, 's', 'b'), null);
  assert.deepEqual(dropInQueue(q, 'b', 's'), ['s', 'b', 'a']);
  assert.equal(dropInQueue(q, 'a', 's'), null); // already right below it
  assert.deepEqual(pinStarred(q, ['b', 'a', 's']), ['s', 'b', 'a']);
  assert.equal(pinStarred(q, ['a', 's', 'b']), null);
});

test('missingSetup flags blank cadence and blank or "-" routine', () => {
  assert.deepEqual(missingSetup(ns('a')), { cadence: true, routine: true });
  assert.deepEqual(missingSetup(ns('a', { cadence: 'Daily', routine: '-' })), { cadence: false, routine: true });
  assert.deepEqual(missingSetup(ns('a', { cadence: 'Weekly', routine: 'Morning' })), { cadence: false, routine: false });
});

test('moveToNext puts a habit at #1 and bumps the old #1 to #2', () => {
  const q = startQueue([ns('a'), ns('b'), ns('s', { nextUp: true })]);
  assert.deepEqual(moveToNext(q, 'b'), ['b', 's', 'a']);
  assert.equal(moveToNext(q, 's'), null);
  assert.equal(moveToNext(q, 'zzz'), null);
});

// Wave 2 — ⚠️ same cases as PrepDay's suite.
const waveHabits = () => [ns('a'), ns('w1', { wave2: true, startOrder: 5 }), ns('b'), ns('w2', { wave2: true, startOrder: 2 }), ns('s', { nextUp: true, wave2: true })];

test('Wave 2 queues Next, then Wave 2, then Later — each by startOrder', () => {
  assert.deepEqual(startQueue(waveHabits()).map(h => h.id), ['s', 'w2', 'w1', 'a', 'b']);
  assert.equal(isWave2(ns('s', { nextUp: true, wave2: true })), false);
});

test('Wave 2: a drag reorders within a group; a drop across groups snaps back', () => {
  const q = startQueue(waveHabits());
  assert.deepEqual(dropInQueue(q, 'w1', 'w2'), ['s', 'w1', 'w2', 'a', 'b']);
  assert.equal(dropInQueue(q, 'a', 'w2'), null);
  assert.deepEqual(pinStarred(q, ['b', 'a', 'w1', 's', 'w2']), ['s', 'w1', 'w2', 'b', 'a']);
});

test('wave2Seam puts a habit at the end of Wave 2 / top of Later', () => {
  const q = startQueue(waveHabits());
  assert.deepEqual(wave2Seam(q, 'b'), ['s', 'w2', 'w1', 'b', 'a']);
  assert.deepEqual(wave2Seam(q, 'w2'), ['s', 'w1', 'w2', 'a', 'b']);
  assert.equal(wave2Seam(q, 's'), null);
  assert.equal(wave2Seam(q, 'zzz'), null);
});

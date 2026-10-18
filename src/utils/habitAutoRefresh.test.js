import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advanceAutoRefresh, stampAutoStatusChanges, nextRefreshCandidate, refreshReturnKey } from './habitAutoRefresh.js';

const auto = (id, extra = {}) => ({ id, status: 'Automatically', ...extra });

test('pushes the longest-unrefreshed automatic habit out, undated first', () => {
  const habits = [auto('a', { autoSince: '2026-09-01' }), auto('b'), auto('c', { autoSince: '2026-08-01' })];
  const next = advanceAutoRefresh(habits, '2026-10-18');
  assert.equal(next.find(h => h.id === 'b').status, 'Refreshing');
  assert.equal(next.find(h => h.id === 'b').refreshStartedAt, '2026-10-18');
  assert.equal(next.filter(h => h.status === 'Refreshing').length, 1);
});

test('only one out at a time; nothing changes mid-refresh', () => {
  const habits = [auto('a'), { id: 'b', status: 'Refreshing', refreshStartedAt: '2026-10-01' }];
  assert.equal(advanceAutoRefresh(habits, '2026-10-18'), habits);
});

test('a hand-set Refreshing habit does not hold the rotation slot', () => {
  const habits = [auto('a'), { id: 'b', status: 'Refreshing' }];
  const next = advanceAutoRefresh(habits, '2026-10-18');
  assert.equal(next.find(h => h.id === 'a').status, 'Refreshing');
});

test('returns after 60 days with a refreshed date, and the next goes out', () => {
  const habits = [
    { id: 'b', status: 'Refreshing', refreshStartedAt: '2026-08-19' },
    auto('a', { autoSince: '2026-01-01' }),
  ];
  assert.equal(refreshReturnKey(habits[0]), '2026-10-18');
  assert.equal(advanceAutoRefresh(habits, '2026-10-17'), habits);
  const next = advanceAutoRefresh(habits, '2026-10-18');
  const b = next.find(h => h.id === 'b');
  assert.deepEqual(
    [b.status, b.autoSince, b.autoSinceHow, b.autoRefreshedAt, b.refreshStartedAt],
    ['Automatically', '2026-10-18', 'refreshed', '2026-10-18', undefined],
  );
  assert.equal(next.find(h => h.id === 'a').status, 'Refreshing');
});

test('a lone automatic habit is not sent straight back out the day it returns', () => {
  const habits = [{ id: 'b', status: 'Refreshing', refreshStartedAt: '2026-08-19' }];
  const next = advanceAutoRefresh(habits, '2026-10-18');
  assert.equal(next[0].status, 'Automatically');
  assert.equal(advanceAutoRefresh(next, '2026-10-19')[0].status, 'Refreshing');
});

test('bad habits are never picked', () => {
  assert.equal(nextRefreshCandidate([auto('x', { habitType: 'bad' })], '2026-10-18'), null);
});

test('marking a habit Automatically stamps the date it was added', () => {
  const prev = [{ id: 'a', status: 'Most Days' }];
  const next = stampAutoStatusChanges(prev, [{ id: 'a', status: 'Automatically' }], '2026-10-18');
  assert.equal(next[0].autoSince, '2026-10-18');
  assert.equal(next[0].autoSinceHow, 'marked');
});

test('moving the rotation habit off Refreshing by hand frees the slot', () => {
  const prev = [{ id: 'a', status: 'Refreshing', refreshStartedAt: '2026-10-01' }];
  const next = stampAutoStatusChanges(prev, [{ ...prev[0], status: 'Most Days' }], '2026-10-18');
  assert.equal(next[0].refreshStartedAt, undefined);
});

test('unchanged statuses and new habits are left alone', () => {
  const prev = [{ id: 'a', status: 'Automatically' }];
  const same = [{ id: 'a', status: 'Automatically', name: 'x' }, { id: 'n', status: 'Automatically' }];
  assert.equal(stampAutoStatusChanges(prev, same, '2026-10-18'), same);
});

test('moving into Refreshing stamps refreshingSince', () => {
  const prev = [{ id: 'a', status: 'Most Days', refreshingSince: '2026-01-02' }];
  const next = stampAutoStatusChanges(prev, [{ ...prev[0], status: 'Refreshing' }], '2026-10-18');
  assert.equal(next[0].refreshingSince, '2026-10-18');
  // Staying on Refreshing keeps the date it went in.
  const again = stampAutoStatusChanges(next, [{ ...next[0], name: 'renamed' }], '2026-10-20');
  assert.equal(again[0].refreshingSince, '2026-10-18');
});

test('a stale marker on a habit moved off Refreshing elsewhere is cleared', () => {
  const habits = [{ id: 'b', status: 'Most Days', refreshStartedAt: '2026-10-01' }];
  assert.equal(advanceAutoRefresh(habits, '2026-10-18')[0].refreshStartedAt, undefined);
});

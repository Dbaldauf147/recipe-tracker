import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recentPlaces } from './recentPlaces.js';

const now = new Date('2026-10-29T15:00:00');

test('newest first, undated spots dropped', () => {
  const rows = recentPlaces([
    { id: 'a', name: 'Old', lastVisit: '2026-01-05T17:00:00.000Z' },
    { id: 'b', name: 'New', lastVisit: '2026-10-27T16:00:00.000Z' },
    { id: 'c', name: 'Never', status: 'want-to-try' },
  ], { now });
  assert.deepEqual(rows.map(r => r.spot.id), ['b', 'a']);
  assert.equal(rows[0].date, '2026-10-27');
  assert.equal(rows[0].days, 2);
});

test('a later logged visit outranks lastVisit, and carries the count', () => {
  const stats = new Map([['a', { count: 3, last: '2026-10-28' }]]);
  const rows = recentPlaces([
    { id: 'a', name: 'A', lastVisit: '2026-09-01T16:00:00.000Z' },
    { id: 'b', name: 'B', lastVisit: '2026-10-01T16:00:00.000Z' },
  ], { statsFor: s => stats.get(s.id), now });
  assert.deepEqual(rows.map(r => [r.spot.id, r.date, r.visits]), [['a', '2026-10-28', 3], ['b', '2026-10-01', 0]]);
});

test('only your own spots; same day sorts by name', () => {
  const rows = recentPlaces([
    { id: 'z', name: 'Zed', lastVisit: '2026-10-20T16:00:00.000Z' },
    { id: 'f', name: 'Friend', lastVisit: '2026-10-28T16:00:00.000Z', _ownerUid: 'x' },
    { id: 'a', name: 'Abe', lastVisit: '2026-10-20T16:00:00.000Z' },
  ], { isMine: s => s._ownerUid !== 'x', now });
  assert.deepEqual(rows.map(r => r.spot.name), ['Abe', 'Zed']);
});

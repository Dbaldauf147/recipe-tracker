import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastVisitDays, shortAgo, rowRatings } from './listRowSummary.js';

const now = new Date('2026-11-12T15:00:00');

test('days since: later of lastVisit and logged visits', () => {
  assert.equal(lastVisitDays({ lastVisit: '2026-11-02T17:00:00.000Z' }, { now }), 10);
  assert.equal(lastVisitDays({ lastVisit: '2026-10-01T17:00:00.000Z' }, { stats: { last: '2026-11-10' }, now }), 2);
  assert.equal(lastVisitDays({ lastVisit: '2026-11-11T17:00:00.000Z' }, { stats: { last: '2026-10-01' }, now }), 1);
});

test('days since: null without a date or on a friend’s spot', () => {
  assert.equal(lastVisitDays({ status: 'visited' }, { now }), null);
  assert.equal(lastVisitDays({ lastVisit: '2026-11-02T17:00:00.000Z' }, { isMine: false, now }), null);
  assert.equal(lastVisitDays(null, { now }), null);
});

test('shortAgo', () => {
  assert.equal(shortAgo(null), '');
  assert.equal(shortAgo(0), 'Today');
  assert.equal(shortAgo(12), '12d ago');
  assert.equal(shortAgo(91), '3mo ago');
  assert.equal(shortAgo(365), '1y ago');
  assert.equal(shortAgo(548), '1.5y ago');
});

test('rowRatings: mine apart from others, others by name, unscored skipped', () => {
  const docs = [
    { authorUid: 'z', authorUsername: 'zed', scores: { food: 3 } },
    { authorUid: 'me', authorUsername: 'dan', scores: { food: 5, vibe: 4 } },
    { authorUid: 'j', authorUsername: 'joanne', scores: { food: 4 } },
    { authorUid: 'x', authorUsername: 'empty', scores: {} },
  ];
  const { mine, others } = rowRatings(docs, 'me');
  assert.equal(mine, 4.5);
  assert.deepEqual(others.map(o => [o.name, o.overall]), [['joanne', 4], ['zed', 3]]);
});

test('rowRatings: legacy star rating stands in for an unscored mine', () => {
  assert.equal(rowRatings([], 'me', 4).mine, 4);
  assert.equal(rowRatings([{ authorUid: 'me', scores: { food: 2 } }], 'me', 4).mine, 2);
  assert.equal(rowRatings([], 'me', null).mine, null);
});

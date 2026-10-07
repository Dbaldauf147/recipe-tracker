import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVisit, spotAfterVisit, spotAfterRemoval, applyVisitOps, visitStatsByPlace } from './spotVisits.js';

const spots = () => [
  { id: 'feed', name: 'Feed and Grain', status: 'visited', lastVisit: '2026-08-01T16:00:00.000Z' },
  { id: 'ritz', name: 'Ritz Cafe', status: 'want-to-try' },
  { id: 'other', name: 'Untouched' },
];
const add = (externalId, placeId, date, amount = 20) => ({ op: 'add', externalId, placeId, date, amount, merchant: 'TST*X', loggedAt: 'now' });

test('a visit needs an id, a spot, a day and a number', () => {
  assert.equal(normalizeVisit({ placeId: 'a', date: '2026-09-01', amount: 1 }).error, 'externalId is required');
  assert.equal(normalizeVisit({ externalId: 'x', placeId: 'a', date: '9/1/2026', amount: 1 }).error, 'date must be YYYY-MM-DD');
  // Charges arrive negative from a ledger; what was spent is stored positive.
  assert.equal(normalizeVisit({ externalId: 'x', placeId: 'a', date: '2026-09-01', amount: -67.54 }).visit.amount, 67.54);
});

test('a visit moves lastVisit forward and makes a want-to-try spot visited', () => {
  assert.equal(spotAfterVisit(spots()[0], '2026-09-22').lastVisit.slice(0, 10), '2026-09-22');
  assert.equal(spotAfterVisit(spots()[0], '2026-07-01'), null); // older than what's there
  const ritz = spotAfterVisit(spots()[1], '2026-09-21');
  assert.equal(ritz.status, 'visited');
  assert.equal(ritz.lastVisit.slice(0, 10), '2026-09-21');
});

test('taking a visit back only rewinds lastVisit when it was that visit', () => {
  const spot = { id: 's', lastVisit: '2026-09-22T16:00:00.000Z' };
  assert.equal(spotAfterRemoval(spot, '2026-09-22', ['2026-09-01']).lastVisit.slice(0, 10), '2026-09-01');
  assert.equal(spotAfterRemoval(spot, '2026-09-01', []), null);
  assert.equal(spotAfterRemoval(spot, '2026-09-22', []), null);            // nothing to rewind to
  assert.equal(spotAfterRemoval(spot, '2026-09-22', ['2026-09-22']), null); // another visit that day
});

test('ops add visits and patch only the spots they touch', () => {
  const restaurants = spots();
  const out = applyVisitOps({ restaurants, ops: [add('t1', 'feed', '2026-09-22', -67.54), add('t2', 'ritz', '2026-09-21')] });
  assert.deepEqual(out.results.map(r => r.ok), [true, true]);
  assert.deepEqual(Object.keys(out.visits), ['t1', 't2']);
  assert.equal(out.visits.t1.amount, 67.54);
  assert.equal(out.restaurants[1].status, 'visited');
  assert.equal(out.restaurants[2], restaurants[2]); // same object, untouched
  assert.equal(out.changed, true);
});

test('sending the same charge again is one visit, and re-mapping moves it', () => {
  let s = applyVisitOps({ restaurants: spots(), ops: [add('t1', 'feed', '2026-09-22')] });
  s = applyVisitOps({ visits: s.visits, restaurants: s.restaurants, ops: [add('t1', 'feed', '2026-09-22')] });
  assert.equal(Object.keys(s.visits).length, 1);
  s = applyVisitOps({ visits: s.visits, restaurants: s.restaurants, ops: [add('t1', 'ritz', '2026-09-22')] });
  assert.equal(s.visits.t1.placeId, 'ritz');
  assert.equal(Object.keys(s.visits).length, 1);
});

test('remove deletes the visit and an unknown spot is refused, not invented', () => {
  let s = applyVisitOps({ restaurants: spots(), ops: [add('t1', 'feed', '2026-09-22')] });
  s = applyVisitOps({ visits: s.visits, restaurants: s.restaurants, ops: [{ op: 'remove', externalId: 't1' }, add('t9', 'nope', '2026-09-01')] });
  assert.deepEqual(s.visits, {});
  assert.deepEqual(s.results, [{ externalId: 't1', ok: true }, { externalId: 't9', ok: false, error: 'No spot with that id' }]);
});

test('stats per spot: count, total, newest first', () => {
  const stats = visitStatsByPlace({
    a: { placeId: 'feed', date: '2026-09-06', amount: 85.71 },
    b: { placeId: 'feed', date: '2026-09-22', amount: 67.54 },
    c: { placeId: 'ritz', date: '2026-09-21', amount: 68.68 },
  });
  const feed = stats.get('feed');
  assert.equal(feed.count, 2);
  assert.equal(feed.total, 153.25);
  assert.equal(feed.last, '2026-09-22');
  assert.deepEqual(feed.visits.map(v => v.externalId), ['b', 'a']);
});

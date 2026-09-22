import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVE_WINDOW_DAYS, activeUsersIn, totalUsersIn, summarizeUserGrowth, growthHeadline,
} from '../../lib/adminGrowth.js';

// The user-growth series behind the admin dashboard's "Users over time" chart
// and the owner's copy of the weekly summary email. Lives in lib/ with the
// other shared email code; tested from here because `npm test` only globs
// src/**/*.test.js.
//
// The part worth pinning down is the anchor: "active" is measured against the
// day the snapshot was TAKEN, not against today. Measure it against today and
// every row older than a week reports zero active users, which looks exactly
// like a product nobody ever used.

const user = (uid, lastLogin, mobileLastLogin = '') => ({
  uid, email: `${uid}@x.com`, lastLogin, mobileLastLogin, loginCount: 3, mobileLoginCount: 0, recipeCount: 2,
});

const snap = (date, users, totals) => ({
  date, takenAt: `${date}T11:45:00.000Z`, users,
  totals: totals || { users: users.length },
});

test('active counts the users seen within the window BEFORE that snapshot', () => {
  const s = snap('2026-09-20', [
    user('a', '2026-09-19T10:00:00Z'),      // yesterday — active
    user('b', '2026-09-14T10:00:00Z'),      // 6 days back — active
    user('c', '2026-09-01T10:00:00Z'),      // 3 weeks back — not
    user('d', ''),                          // never signed in — not
  ]);
  assert.equal(activeUsersIn(s), 2);
  assert.equal(totalUsersIn(s), 4);
  assert.equal(ACTIVE_WINDOW_DAYS, 7);
});

test('a user last seen on the app counts, same as one last seen on the web', () => {
  const s = snap('2026-09-20', [
    user('a', '2026-01-01T10:00:00Z', '2026-09-18T10:00:00Z'), // stale web, fresh app
  ]);
  assert.equal(activeUsersIn(s), 1);
});

test('an old snapshot is still scored against its own day, not today', () => {
  // Every reading here is months old. Anchored to `takenAt` it reports 1
  // active; anchored to now it would report 0 and the whole history would
  // flatline to zero.
  const s = snap('2026-03-10', [
    user('a', '2026-03-08T10:00:00Z'),
    user('b', '2026-02-01T10:00:00Z'),
  ]);
  assert.equal(activeUsersIn(s), 1);
});

test('a snapshot with no per-user rows is unknown, not zero', () => {
  assert.equal(activeUsersIn({ date: '2026-09-20', totals: { users: 9 } }), null);
  // …and the total still comes through, so the chart draws the line it can.
  assert.equal(totalUsersIn({ date: '2026-09-20', totals: { users: 9 } }), 9);
  // No totals either: fall back to counting the rows.
  assert.equal(totalUsersIn({ date: '2026-09-20', users: [user('a', '')] }), 1);
});

test('every snapshot is its own point while they still fit', () => {
  const rows = ['2026-09-18', '2026-09-19', '2026-09-20'].map(d => snap(d, [user('a', `${d}T09:00:00Z`)]));
  const g = summarizeUserGrowth(rows, { maxPoints: 12 });
  assert.equal(g.length, 3);
  assert.deepEqual(g.map(p => p.date), ['2026-09-18', '2026-09-19', '2026-09-20']);
  assert.equal(g[0].label, 'Sep 18');
  assert.equal(g[2].active, 1);
});

test('past the cap it thins to the last snapshot of each week', () => {
  // 28 consecutive days, one user added every day.
  const rows = [];
  for (let d = 1; d <= 28; d++) {
    const date = `2026-09-${String(d).padStart(2, '0')}`;
    rows.push(snap(date, Array.from({ length: d }, (_, i) => user(`u${i}`, `${date}T09:00:00Z`))));
  }
  const g = summarizeUserGrowth(rows, { maxPoints: 12 });
  // Sep 2026 starts on a Tuesday, so the Sunday-anchored weeks end Sep 5, 12,
  // 19, 26 — plus the partial week the run stops in (Sep 28).
  assert.deepEqual(g.map(p => p.date), ['2026-09-05', '2026-09-12', '2026-09-19', '2026-09-26', '2026-09-28']);
  assert.deepEqual(g.map(p => p.total), [5, 12, 19, 26, 28]);
});

test('unsorted and malformed rows do not derail the series', () => {
  const rows = [
    snap('2026-09-20', [user('a', '2026-09-20T09:00:00Z')]),
    null,
    { date: 'not-a-date', users: [] },
    snap('2026-09-18', [user('a', '2026-09-18T09:00:00Z')]),
  ];
  const g = summarizeUserGrowth(rows);
  assert.deepEqual(g.map(p => p.date), ['2026-09-18', '2026-09-20']);
});

test('headline reports the latest reading and its change over the span', () => {
  const g = [
    { date: '2026-09-06', label: 'Sep 6', total: 8, active: 3 },
    { date: '2026-09-13', label: 'Sep 13', total: 11, active: 2 },
    { date: '2026-09-20', label: 'Sep 20', total: 14, active: 5 },
  ];
  const h = growthHeadline(g);
  assert.equal(h.total, 14);
  assert.equal(h.totalChange, 6);
  assert.equal(h.active, 5);
  assert.equal(h.activeChange, 2);
  assert.equal(h.from, '2026-09-06');
});

test('headline skips unknown readings rather than treating them as zero', () => {
  const h = growthHeadline([
    { date: '2026-09-06', label: 'Sep 6', total: 8, active: null },
    { date: '2026-09-20', label: 'Sep 20', total: 14, active: null },
  ]);
  assert.equal(h.active, null);
  assert.equal(h.activeChange, null);
  assert.equal(h.totalChange, 6);
});

test('an empty history produces nothing to draw', () => {
  assert.deepEqual(summarizeUserGrowth([]), []);
  assert.deepEqual(summarizeUserGrowth(null), []);
  assert.equal(growthHeadline([]).total, null);
});

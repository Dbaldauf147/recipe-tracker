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
  const { points: g, grain } = summarizeUserGrowth(rows, { maxPoints: 12 });
  assert.equal(grain, 'day');
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
  const { points: g, grain } = summarizeUserGrowth(rows, { maxPoints: 12 });
  assert.equal(grain, 'week');
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
  const { points: g } = summarizeUserGrowth(rows);
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
  assert.deepEqual(summarizeUserGrowth([]).points, []);
  assert.deepEqual(summarizeUserGrowth(null).points, []);
  assert.equal(growthHeadline([]).total, null);
});

// ── All-time span ─────────────────────────────────────────────────────────
// The series used to end in `slice(-maxPoints)`, so a chart sold as the
// history of the user base quietly became "the last 30 points" after about
// seven months of daily snapshots. The grain may coarsen; the span may not.

/** `n` daily snapshots ending on 2026-09-30, one user added per day. */
function dailyRun(n) {
  const rows = [];
  const end = new Date('2026-09-30T00:00:00Z');
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    const date = d.toISOString().slice(0, 10);
    rows.push(snap(date, [user('a', `${date}T09:00:00Z`)], { users: n - i }));
  }
  return rows;
}

// A bucket is represented by its LAST snapshot, so the first point sits at the
// end of the period the history starts in — not on its first day. What matters
// is that the series still REACHES that period instead of starting near today.
const month = d => d.slice(0, 7);

test('two years of daily snapshots still reach back two years', () => {
  const rows = dailyRun(730);
  const { points, grain } = summarizeUserGrowth(rows, { maxPoints: 30 });
  assert.equal(grain, 'month');
  assert.ok(points.length <= 30, `got ${points.length} points`);
  assert.equal(month(points[0].date), month(rows[0].date));
  assert.equal(points[points.length - 1].date, rows[rows.length - 1].date);
  // The old slice(-30) would have started 30 days back; this starts 2 years back.
  assert.ok(points[0].date < '2024-11-01', `series starts at ${points[0].date}`);
});

test('months are chosen only once weeks no longer fit', () => {
  // 20 weeks still fits in 30 points as weeks, so it must not coarsen further.
  const rows = dailyRun(140);
  const { grain, points } = summarizeUserGrowth(rows, { maxPoints: 30 });
  assert.equal(grain, 'week');
  // First point lands in the run's opening week, not later.
  assert.ok(points[0].date >= rows[0].date && points[0].date < '2026-05-21',
    `first point ${points[0].date}`);
});

test('a span too long even for months is thinned, never truncated', () => {
  const rows = dailyRun(365 * 12); // 12 years
  const { points, grain } = summarizeUserGrowth(rows, { maxPoints: 30 });
  assert.equal(grain, 'sparse');
  assert.ok(points.length <= 31, `got ${points.length} points`);
  assert.equal(month(points[0].date), month(rows[0].date));
  assert.equal(points[points.length - 1].date, rows[rows.length - 1].date);
});

// ── Compacted snapshots ───────────────────────────────────────────────────
// Past the cron's detail window a day keeps its totals and loses its rows, so
// the count it can no longer derive has to have been stored before they went.

test('a compacted snapshot reports the active count stored on it', () => {
  const compacted = { date: '2025-01-05', takenAt: '2025-01-05T11:45:00.000Z', totals: { users: 9, activeUsers: 4 } };
  assert.equal(activeUsersIn(compacted), 4);
  assert.equal(totalUsersIn(compacted), 9);
});

test('a stored count is trusted only for the window it was computed for', () => {
  const compacted = { date: '2025-01-05', totals: { users: 9, activeUsers: 4 } };
  // A different window can't be answered from a number computed for 7 days,
  // and there are no rows left to recount.
  assert.equal(activeUsersIn(compacted, 30), null);
});

test('stored zero is a real reading, and a missing one is still unknown', () => {
  assert.equal(activeUsersIn({ date: '2025-01-05', totals: { users: 9, activeUsers: 0 } }), 0);
  assert.equal(activeUsersIn({ date: '2025-01-05', totals: { users: 9 } }), null);
  // A null that slipped into storage must not read back as "nobody active".
  assert.equal(activeUsersIn({ date: '2025-01-05', totals: { users: 9, activeUsers: null } }), null);
});

test('live rows still win where both exist and disagree is impossible', () => {
  // Same snapshot, rows intact: the stored figure is what the rows say.
  const s = snap('2026-09-20', [user('a', '2026-09-19T10:00:00Z')], { users: 1, activeUsers: 1 });
  assert.equal(activeUsersIn(s), 1);
});

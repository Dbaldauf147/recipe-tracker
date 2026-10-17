import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoPromoteEta, autoPromoteNumbers as autoPromoteProgress, autoPromoteAnswerExpired } from './habitAutoPromote.js';
import { dayKey } from './habitOutstanding.js';

const TODAY = new Date(2026, 9, 6); // Tue 6 Oct 2026
const daysAgo = n => dayKey(new Date(2026, 9, 6 - n));
const habit = { id: 'h1', cadence: 'Daily', status: 'Most Days' };
const etaOf = (h, l) => (({ days, completions }) => ({ days, completions }))(autoPromoteEta(h, l, TODAY));

/** Mark `n` days before today (not today), starting `from` days ago, with `mark`. */
function log(n, mark = 'done', from = 1) {
  const out = {};
  for (let i = from; i < from + n; i++) out[daysAgo(i)] = { h1: mark };
  return out;
}

test('needs more than 90% of 60 logged days: 55 done', () => {
  const l = { ...log(54), ...log(6, 'missed', 55) };
  const p = autoPromoteProgress(habit, l, TODAY);
  assert.equal(p.total, 60);
  assert.equal(p.needed, 55);
  assert.equal(p.shortBy, 1);
  assert.equal(p.earned, false);
  assert.deepEqual(etaOf(habit, l), { days: 0, completions: 1 });
  assert.equal(autoPromoteProgress(habit, { ...log(55), ...log(5, 'missed', 56) }, TODAY).earned, true);
});

test('skipped and unlogged days are passed over, not counted against', () => {
  // 55 done + 5 no, with a 10-day PTO skip and some blank days in between.
  const l = { ...log(20), ...log(10, 'skipped', 21), ...log(35, 'done', 36), ...log(5, 'missed', 71) };
  const p = autoPromoteProgress(habit, l, TODAY);
  assert.equal(p.total, 60);
  assert.equal(p.done, 55);
  assert.equal(p.missed, 5);
  assert.equal(p.skipped, 10);
  assert.equal(p.blank, 5); // days 31–35
  assert.equal(p.earned, true);
});

test('looks past the 60 calendar days for older logged days', () => {
  const l = { ...log(30), ...log(30, 'done', 100) };
  const p = autoPromoteProgress(habit, l, TODAY);
  assert.equal(p.total, 60);
  assert.equal(p.earned, true);
});

test('fewer than 60 logged days ever cannot qualify', () => {
  const p = autoPromoteProgress(habit, log(40), TODAY);
  assert.equal(p.total, 40);
  assert.equal(p.rate, 100);
  assert.equal(p.earned, false);
  assert.equal(p.shortBy, 20);
  assert.deepEqual(etaOf(habit, log(40)), { days: 19, completions: 20 });
});

test('a brand-new habit needs 60 completions', () => {
  assert.deepEqual(etaOf(habit, {}), { days: 59, completions: 60 });
});

test('old done days ageing out push the finish line back', () => {
  // 30 recent misses, 30 older done: every new "Did it" pushes out an old done.
  const l = { ...log(30, 'missed'), ...log(30, 'done', 31) };
  assert.equal(autoPromoteProgress(habit, l, TODAY).shortBy, 55);
});

test('recent done days carry you', () => {
  const l = { ...log(30), ...log(30, 'missed', 31) };
  assert.equal(autoPromoteProgress(habit, l, TODAY).shortBy, 25);
  assert.equal(etaOf(habit, l).completions, 25);
});

test('weekday-only habits count tracked days, not calendar days', () => {
  const weekdays = { ...habit, trackDays: [1, 2, 3, 4, 5] };
  const eta = autoPromoteEta(weekdays, {}, TODAY);
  assert.equal(eta.completions, 60);
  assert.ok(eta.days > eta.completions);
});

test('a today already logged is not counted as a future completion', () => {
  const l = { ...log(54), ...log(5, 'missed', 55), [daysAgo(0)]: { h1: 'missed' } };
  assert.deepEqual(etaOf(habit, l), { days: 1, completions: 1 });
});

test('weekly habits are not watched', () => {
  assert.equal(autoPromoteProgress({ ...habit, cadence: 'Weekly' }, {}, TODAY).daily, false);
  assert.equal(autoPromoteEta({ ...habit, cadence: 'Weekly' }, {}, TODAY), null);
});

test('marks the day the habit crossed the line', async () => {
  const { autoPromoteQualifiedDays, autoPromoteAnswerExpired } = await import('./habitAutoPromote.js');
  // Days 1–60 ago all done: it first had 60 logged days (all done) as of yesterday.
  const l = log(60);
  const days = autoPromoteQualifiedDays(habit, l, new Date(2026, 8, 1), TODAY);
  assert.deepEqual([...days], [daysAgo(1)]);
  // A miss-heavy habit never qualifies.
  assert.equal(autoPromoteQualifiedDays(habit, log(60, 'missed'), new Date(2026, 8, 1), TODAY).size, 0);
});

test('a "keep tracking" answer holds until 60 fresh logged days come after it', () => {
  const declined = { ...habit, autoPromoteDeclinedAt: new Date(2026, 8, 1, 12).toISOString() }; // 1 Sep
  // 60 done days ending yesterday (7 Aug – 5 Oct): the oldest is before 1 Sep.
  assert.equal(autoPromoteAnswerExpired(declined, log(60), TODAY), false);
  // Declined 6 Aug: every one of those 60 days came after it.
  const earlier = { ...habit, autoPromoteDeclinedAt: new Date(2026, 7, 6, 12).toISOString() };
  assert.equal(autoPromoteAnswerExpired(earlier, log(60), TODAY), true);
  assert.equal(autoPromoteAnswerExpired(habit, {}, TODAY), true);
});

// The bad-habit detail panel: the chosen window and the trend bars inside it.
// ⚠️ The phone has the same suite in src/utils/badHabitTrend.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badHabitTrend, badRangeStart, badRangeLabel, normalizeBadRange, trendBucketUnit,
  dayKeyOf, DEFAULT_BAD_RANGE,
} from './badHabits.js';

// Tue 27 Oct 2026.
const NOW = new Date(2026, 9, 27, 15, 0, 0);
const log = (...keys) => Object.fromEntries(keys.map(k => [k, { h: 'done' }]));

test('a bad or missing saved range falls back to the default', () => {
  assert.deepEqual(normalizeBadRange(undefined), DEFAULT_BAD_RANGE);
  assert.deepEqual(normalizeBadRange({ n: 4, unit: 'fortnights' }), DEFAULT_BAD_RANGE);
  assert.deepEqual(normalizeBadRange({ n: 0, unit: 'weeks' }), { n: 1, unit: 'weeks' });
  assert.deepEqual(normalizeBadRange({ n: '2.6', unit: 'days' }), { n: 3, unit: 'days' });
  assert.deepEqual(normalizeBadRange({ n: 5000, unit: 'years' }), { n: 999, unit: 'years' });
});

test('labels read naturally', () => {
  assert.equal(badRangeLabel({ n: 1, unit: 'months' }), 'Last month');
  assert.equal(badRangeLabel({ n: 10, unit: 'days' }), 'Last 10 days');
  assert.equal(badRangeLabel({ n: 1, unit: 'all' }), 'All time');
});

test('windows include today and span exactly the chosen length', () => {
  assert.equal(dayKeyOf(badRangeStart({ n: 1, unit: 'days' }, NOW)), '2026-10-27');
  assert.equal(dayKeyOf(badRangeStart({ n: 2, unit: 'weeks' }, NOW)), '2026-10-14');
  assert.equal(dayKeyOf(badRangeStart({ n: 1, unit: 'months' }, NOW)), '2026-09-28');
  assert.equal(dayKeyOf(badRangeStart({ n: 1, unit: 'years' }, NOW)), '2025-10-28');
  assert.equal(dayKeyOf(badRangeStart({ n: 1, unit: 'all' }, NOW, '2024-02-01')), '2024-02-01');
  assert.equal(dayKeyOf(badRangeStart({ n: 1, unit: 'all' }, NOW, null)), '2026-10-27');
});

test('bar size grows with the window', () => {
  assert.equal(trendBucketUnit(14), 'day');
  assert.equal(trendBucketUnit(92), 'week');
  assert.equal(trendBucketUnit(365), 'month');
  assert.equal(trendBucketUnit(2000), 'year');
});

test('two-week window: one bar per day, slips outside the window ignored', () => {
  const t = badHabitTrend('h', log('2026-10-01', '2026-10-14', '2026-10-20', '2026-10-27'), { n: 2, unit: 'weeks' }, NOW);
  assert.equal(t.unit, 'day');
  assert.equal(t.buckets.length, 14);
  assert.equal(t.total, 3);
  assert.equal(t.cleanDays, 11);
  assert.equal(t.buckets[0].count, 1);       // Oct 14
  assert.equal(t.buckets[13].count, 1);      // today
  assert.equal(t.longestClean, 6);           // Oct 21–26
});

test('weekly bars are Sunday-aligned and the clipped first week says how many days it holds', () => {
  const t = badHabitTrend('h', log('2026-08-01', '2026-10-25', '2026-10-26'), { n: 3, unit: 'months' }, NOW);
  assert.equal(t.unit, 'week');
  assert.equal(t.startKey, '2026-07-28');
  assert.equal(t.buckets[0].key, '2026-07-26');  // Sunday before the start
  assert.equal(t.buckets[0].days, 5);            // Jul 28 – Aug 1
  assert.equal(t.buckets[0].count, 1);
  const last = t.buckets[t.buckets.length - 1];
  assert.equal(last.key, '2026-10-25');
  assert.equal(last.days, 3);                    // Sun–Tue
  assert.equal(last.count, 2);
  assert.equal(t.buckets.reduce((a, b) => a + b.days, 0), t.spanDays);
});

test('PTO skips never count as slips in the trend', () => {
  const t = badHabitTrend('h', { '2026-10-20': { h: 'skipped' }, '2026-10-21': { h: 'done' } }, { n: 2, unit: 'weeks' }, NOW);
  assert.equal(t.total, 1);
});

test('a habit with no slips is one long clean run', () => {
  const t = badHabitTrend('h', {}, { n: 1, unit: 'months' }, NOW);
  assert.equal(t.total, 0);
  assert.equal(t.longestClean, t.spanDays);
  assert.equal(t.perWeek, 0);
});

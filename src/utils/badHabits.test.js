import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badHabitStats, occurrenceDays, recentDayKeys, cleanLabel,
  daysBetween, dateOfDayKey, dayKeyOf,
} from './badHabits.js';

// Thu 3 Sep 2026. That week's Sunday is Aug 30.
const NOW = new Date(2026, 8, 3, 14, 0, 0);

test('occurrences are the day keys the habit is marked on, oldest first', () => {
  const log = {
    '2026-09-01': { b1: 'done' },
    '2026-08-28': { b1: 'done', g1: 'done' },
    '2026-09-03': { g1: 'done' },
  };
  assert.deepEqual(occurrenceDays('b1', log), ['2026-08-28', '2026-09-01']);
  assert.deepEqual(occurrenceDays('nope', log), []);
});

test('non-day keys are never read as an occurrence', () => {
  // A weekly or monthly bucket in the same log must not be counted as a slip,
  // or one stray key would silently reset "days clean".
  const log = {
    '2026-W36': { b1: 'done' },
    '2026-09': { b1: 'done' },
    '2026': { b1: 'done' },
  };
  assert.deepEqual(occurrenceDays('b1', log), []);
  assert.equal(badHabitStats('b1', log, NOW).total, 0);
});

test('days clean counts from the last slip', () => {
  const stats = badHabitStats('b1', { '2026-08-25': { b1: 'done' } }, NOW);
  assert.equal(stats.daysClean, 9);
  assert.equal(stats.lastKey, '2026-08-25');
  assert.equal(cleanLabel(stats), '9 days clean');
});

test('a slip today reads as logged today, not as a clean day', () => {
  const stats = badHabitStats('b1', { '2026-09-03': { b1: 'done' } }, NOW);
  assert.equal(stats.daysClean, 0);
  assert.equal(stats.loggedToday, true);
  assert.equal(cleanLabel(stats), 'logged today');
});

test('a habit that has never slipped says so rather than claiming zero', () => {
  const stats = badHabitStats('b1', {}, NOW);
  assert.equal(stats.daysClean, null);
  assert.equal(stats.total, 0);
  assert.equal(stats.loggedToday, false);
  assert.equal(cleanLabel(stats), 'no slips logged yet');
});

test('one day clean is singular', () => {
  const stats = badHabitStats('b1', { '2026-09-02': { b1: 'done' } }, NOW);
  assert.equal(cleanLabel(stats), '1 day clean');
});

test('a slip mis-logged in the future never reports negative days clean', () => {
  const stats = badHabitStats('b1', { '2026-09-20': { b1: 'done' } }, NOW);
  assert.equal(stats.daysClean, 0);
});

test('week, month and 30-day counts each use their own window', () => {
  const log = {
    '2026-08-29': { b1: 'done' },  // Sat — previous week, previous month
    '2026-08-30': { b1: 'done' },  // Sun — this week starts here, still August
    '2026-09-01': { b1: 'done' },  // this week, this month
    '2026-09-03': { b1: 'done' },  // today
    '2026-06-15': { b1: 'done' },  // long ago
  };
  const s = badHabitStats('b1', log, NOW);
  assert.equal(s.total, 5);
  assert.equal(s.thisWeek, 3, 'Sun 30 Aug through today');
  assert.equal(s.thisMonth, 2, 'September only');
  assert.equal(s.last30, 4, 'everything but June');
});

test('the strip is the last n days ending today, oldest first', () => {
  const keys = recentDayKeys(5, NOW);
  assert.deepEqual(keys, ['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03']);
});

test('the strip walks month boundaries by real dates, not by arithmetic on the number', () => {
  const keys = recentDayKeys(3, new Date(2026, 2, 1)); // 1 Mar 2026 → back into Feb
  assert.deepEqual(keys, ['2026-02-27', '2026-02-28', '2026-03-01']);
});

test('day keys round-trip through local midnight, never UTC', () => {
  // A UTC round trip would shift the date for anyone west of Greenwich.
  const d = dateOfDayKey('2026-09-03');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 8);
  assert.equal(d.getDate(), 3);
  assert.equal(dayKeyOf(d), '2026-09-03');
  assert.equal(daysBetween('2026-09-01', '2026-09-03'), 2);
  assert.equal(daysBetween('2026-09-03', '2026-09-01'), -2);
  assert.equal(daysBetween('nonsense', '2026-09-01'), null);
});

test('a day spanning a DST change is still one day apart', () => {
  // US DST springs forward on 8 Mar 2026; that day is 23 hours long, so a
  // plain hour-difference would round to 0 days.
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-03-08', '2026-03-09'), 1);
});

test('a Skip stamped across a holiday is not a slip', () => {
  // PTO stamping writes 'skipped' onto every unmarked cell in a range. Those
  // cells belong to the same habitLog these stats read, and counting any mark
  // rather than the slip mark specifically would turn a week away from home
  // into a week of relapses — and reset "days clean" to zero.
  const log = {
    '2026-08-20': { b1: 'done' },      // a real slip
    '2026-08-28': { b1: 'skipped' },   // holiday
    '2026-08-29': { b1: 'skipped' },
    '2026-08-30': { b1: 'skipped' },
  };
  const s = badHabitStats('b1', log, NOW);
  assert.equal(s.total, 1, 'only the real slip counts');
  assert.equal(s.lastKey, '2026-08-20');
  assert.equal(s.daysClean, 14);
});

test('only the slip mark counts, whatever else lands on the cell', () => {
  for (const mark of ['skipped', 'missed', 'exceeded']) {
    const s = badHabitStats('b1', { '2026-09-02': { b1: mark } }, NOW);
    assert.equal(s.total, 0, `${mark} should not read as a slip`);
    assert.equal(s.daysClean, null);
  }
  assert.equal(badHabitStats('b1', { '2026-09-02': { b1: 'done' } }, NOW).total, 1);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mealStatsForDay, mealStatsForDays, mealsTrackedGoalOf, sundayWeekDates,
  DEFAULT_MEALS_TRACKED_PCT,
} from './mealsTracked.js';

test('a fully logged day is 3 of 3 slots', () => {
  const day = { entries: [
    { mealSlot: 'breakfast' }, { mealSlot: 'lunch' }, { mealSlot: 'dinner' },
  ] };
  assert.equal(mealStatsForDay(day).tracked, 3);
});

test('skipping and eating out both ACCOUNT for a slot', () => {
  // The metric is completeness of the record, not what was eaten — a skipped or
  // eaten-out meal is a decision, so it counts as tracked.
  const day = {
    entries: [{ mealSlot: 'breakfast' }],
    skippedMeals: ['lunch'],
    eatingOutMeals: ['dinner'],
  };
  const s = mealStatsForDay(day);
  assert.equal(s.tracked, 3);
  assert.equal(s.ateOut, 1);
});

test('a duplicated slot is still one slot', () => {
  const day = { entries: [{ mealSlot: 'dinner' }, { mealSlot: 'dinner' }] };
  assert.equal(mealStatsForDay(day).tracked, 1);
});

test('a day marked not-tracked counts as fully accounted for', () => {
  assert.equal(mealStatsForDay({ daySkipped: true }).tracked, 3);
});

test('snacks and unknown slots do not count toward the three main meals', () => {
  const day = { entries: [{ mealSlot: 'snack' }, { mealSlot: 'dessert' }] };
  assert.equal(mealStatsForDay(day).tracked, 0);
});

test('an empty or missing day is zero, not a crash', () => {
  assert.deepEqual(mealStatsForDay(null), { tracked: 0, ateOut: 0 });
  assert.deepEqual(mealStatsForDay(undefined), { tracked: 0, ateOut: 0 });
  assert.deepEqual(mealStatsForDay({}), { tracked: 0, ateOut: 0 });
});

test('the week percentage is over all 21 slots, not the logged days', () => {
  // Three perfect days out of seven is 9/21 = 43%, NOT 100%. Averaging only the
  // days that have data is the classic wrong answer here.
  const days = sundayWeekDates('2026-08-26');
  const log = {};
  for (const d of days.slice(0, 3)) {
    log[d] = { entries: [{ mealSlot: 'breakfast' }, { mealSlot: 'lunch' }, { mealSlot: 'dinner' }] };
  }
  assert.equal(mealStatsForDays(days, log).pct, 43);
});

test('a fully tracked week is 100% and an empty week is 0%', () => {
  const days = sundayWeekDates('2026-08-26');
  const full = {};
  for (const d of days) full[d] = { daySkipped: true };
  assert.equal(mealStatsForDays(days, full).pct, 100);
  assert.equal(mealStatsForDays(days, {}).pct, 0);
});

test('no days means 0%, never a divide-by-zero', () => {
  assert.equal(mealStatsForDays([], {}).pct, 0);
});

test('the goal falls back to 50 and clamps to 0-100', () => {
  assert.equal(mealsTrackedGoalOf(null), DEFAULT_MEALS_TRACKED_PCT);
  assert.equal(mealsTrackedGoalOf({}), DEFAULT_MEALS_TRACKED_PCT);
  assert.equal(mealsTrackedGoalOf({ dailyMealsTrackedPct: 'abc' }), DEFAULT_MEALS_TRACKED_PCT);
  assert.equal(mealsTrackedGoalOf({ dailyMealsTrackedPct: 80 }), 80);
  assert.equal(mealsTrackedGoalOf({ dailyMealsTrackedPct: 0 }), 0, '0% is a real target, not "unset"');
  assert.equal(mealsTrackedGoalOf({ dailyMealsTrackedPct: 140 }), 100);
  assert.equal(mealsTrackedGoalOf({ dailyMealsTrackedPct: -5 }), 0);
});

test('the week runs Sunday to Saturday', () => {
  // 2026-08-26 is a Wednesday.
  const days = sundayWeekDates('2026-08-26');
  assert.equal(days.length, 7);
  assert.equal(days[0], '2026-08-23', 'starts Sunday');
  assert.equal(days[6], '2026-08-29', 'ends Saturday');
  assert.ok(days.includes('2026-08-26'));
});

test('a Sunday belongs to the week it STARTS', () => {
  // The habit week key is Sunday-anchored; an ISO/Monday week would file this
  // Sunday's meals against the previous week's habit cell.
  assert.equal(sundayWeekDates('2026-08-23')[0], '2026-08-23');
  assert.equal(sundayWeekDates('2026-08-29')[0], '2026-08-23', 'Saturday still points back to the same Sunday');
});

test('the week does not shift across a month or year boundary', () => {
  assert.deepEqual(sundayWeekDates('2027-01-01')[0], '2026-12-27');
  assert.equal(sundayWeekDates('2027-01-01').length, 7);
});

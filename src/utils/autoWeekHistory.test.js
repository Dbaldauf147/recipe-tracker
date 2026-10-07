import test from 'node:test';
import assert from 'node:assert/strict';
import { finishedWeekStarts, weekDays, recipesInDays, autoWeekEntries } from './autoWeekHistory.js';

// 2026-10-07 is a Wednesday; this week started Sun 2026-10-04.
const TODAY = '2026-10-07';

test('finished weeks are the Sundays before this one, newest first', () => {
  assert.deepEqual(finishedWeekStarts(TODAY, 3), ['2026-09-27', '2026-09-20', '2026-09-13']);
  // On a Sunday the week that just ended counts; the new one does not.
  assert.deepEqual(finishedWeekStarts('2026-10-04', 1), ['2026-09-27']);
  // Saturday: the current week is not finished yet.
  assert.deepEqual(finishedWeekStarts('2026-10-03', 1), ['2026-09-20']);
});

test('weekDays spans Sun..Sat across a month end', () => {
  assert.deepEqual(weekDays('2026-09-27'), [
    '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03',
  ]);
});

test('recipes: distinct, in order, skipped slots and non-recipe entries left out', () => {
  const log = {
    '2026-09-27': { entries: [{ recipeId: 'chili', mealSlot: 'dinner' }, { type: 'ingredient', ingredientName: 'apple' }] },
    '2026-09-28': {
      entries: [{ recipeId: 'oats', mealSlot: 'breakfast' }, { recipeId: 'chili', mealSlot: 'dinner' }],
      skippedMeals: ['breakfast'],
    },
  };
  assert.deepEqual(recipesInDays(log, weekDays('2026-09-27')), ['chili']);
});

test('one entry per finished week with meals, oldest first', () => {
  const dailyLog = {
    '2026-09-15': { entries: [{ recipeId: 'soup', mealSlot: 'lunch' }] },
    '2026-09-29': { entries: [{ recipeId: 'chili', mealSlot: 'dinner' }] },
    '2026-10-05': { entries: [{ recipeId: 'this-week', mealSlot: 'dinner' }] }, // unfinished week
  };
  const out = autoWeekEntries({ dailyLog, todayKey: TODAY, weeksBack: 4 });
  assert.deepEqual(out, [
    { date: '2026-09-13', weekStart: '2026-09-13', recipeIds: ['soup'], timestamp: '2026-09-19T23:59:59.000Z', source: 'week-plan' },
    { date: '2026-09-27', weekStart: '2026-09-27', recipeIds: ['chili'], timestamp: '2026-10-03T23:59:59.000Z', source: 'week-plan' },
  ]);
});

test('weeks already in history, or processed before, are skipped', () => {
  const dailyLog = {
    '2026-09-15': { entries: [{ recipeId: 'soup' }] },
    '2026-09-22': { entries: [{ recipeId: 'bowl' }] },
    '2026-09-29': { entries: [{ recipeId: 'chili' }] },
  };
  const out = autoWeekEntries({
    dailyLog,
    todayKey: TODAY,
    weeksBack: 4,
    history: [{ date: '2026-09-24', recipeIds: ['bowl'] }], // a reset during the week of 09-20
    doneWeeks: ['2026-09-13'],                                // auto entry deleted by the user
  });
  assert.deepEqual(out.map(e => e.weekStart), ['2026-09-27']);
});

test('nothing to add for empty weeks or bad input', () => {
  assert.deepEqual(autoWeekEntries({ todayKey: TODAY }), []);
  assert.deepEqual(autoWeekEntries({ dailyLog: null, history: null, todayKey: 'nope' }), []);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { produceForDay, produceForDays, produceAveragePerDay } from './produceServings.js';

// The Week Plan's veg & fruit tiles. The tally rules were already settled (a
// skipped day or a skipped slot contributes nothing); what these mostly pin
// down is the DENOMINATOR of the average, because getting it wrong is silent —
// the tile still shows a plausible number, just one measured against the wrong
// number of days.

// Sun 2026-09-20 → Sat 2026-09-26.
const WEEK = ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'];
const meal = (slot, veg, fruit) => ({ mealSlot: slot, nutrition: { vegServings: veg, fruitServings: fruit } });

test('a day sums the servings on its entries', () => {
  const day = { entries: [meal('lunch', 2, 1), meal('dinner', 3.5, 0.5)] };
  assert.deepEqual(produceForDay(day), { veg: 5.5, fruit: 1.5 });
  assert.deepEqual(produceForDay(undefined), { veg: 0, fruit: 0 });
});

test('a skipped day contributes nothing, and so does a skipped slot', () => {
  const entries = [meal('lunch', 4, 2), meal('dinner', 3, 1)];
  assert.deepEqual(produceForDay({ entries, daySkipped: true }), { veg: 0, fruit: 0 });
  // Only the dinner survives.
  assert.deepEqual(produceForDay({ entries, skippedMeals: ['lunch'] }), { veg: 3, fruit: 1 });
});

test('a custom entry with no slot counts as a snack', () => {
  const entries = [{ type: 'custom', nutrition: { vegServings: 2, fruitServings: 1 } }];
  assert.deepEqual(produceForDay({ entries }), { veg: 2, fruit: 1 });
  assert.deepEqual(produceForDay({ entries, skippedMeals: ['snack'] }), { veg: 0, fruit: 0 });
});

test('the average divides by the days that have HAPPENED, not by seven', () => {
  const log = {
    [WEEK[0]]: { entries: [meal('lunch', 6, 2)] },
    [WEEK[1]]: { entries: [meal('lunch', 4, 1)] },
    [WEEK[2]]: { entries: [meal('lunch', 8, 3)] },
  };
  // Tuesday: 18 veg over three days is 6/day, not 18 ÷ 7 = 2.6.
  const tue = produceAveragePerDay(WEEK, log, WEEK[2]);
  assert.equal(tue.elapsed, 3);
  assert.equal(tue.veg, 6);
  assert.equal(tue.fruit, 2);
  assert.deepEqual(tue.total, { veg: 18, fruit: 6 });
});

test('a finished week divides by seven, so history is unchanged by all this', () => {
  const log = Object.fromEntries(WEEK.map(d => [d, { entries: [meal('lunch', 7, 2)] }]));
  const done = produceAveragePerDay(WEEK, log, '2026-09-30');
  assert.equal(done.elapsed, 7);
  assert.equal(done.veg, 7);
  assert.equal(done.total.veg, 49);
});

test('an untracked day still counts toward the denominator', () => {
  // It happened; you just ate no veg that you logged. Dropping it would let a
  // single good day carry the whole week.
  const log = { [WEEK[0]]: { entries: [meal('lunch', 10, 4)] } };
  const wed = produceAveragePerDay(WEEK, log, WEEK[3]);
  assert.equal(wed.elapsed, 4);
  assert.equal(wed.veg, 2.5);
});

test('a week that has not started has no average, rather than an average of 0', () => {
  const future = produceAveragePerDay(WEEK, {}, '2026-09-19');
  assert.equal(future.elapsed, 0);
  assert.equal(future.veg, null);
  assert.equal(future.fruit, null);
});

test('averages round to one decimal, from the unrounded week total', () => {
  const log = {
    [WEEK[0]]: { entries: [meal('lunch', 1, 0)] },
    [WEEK[1]]: { entries: [meal('lunch', 1, 0)] },
    [WEEK[2]]: { entries: [meal('lunch', 1, 0)] },
  };
  assert.equal(produceAveragePerDay(WEEK, log, WEEK[6]).veg, 0.4); // 3 ÷ 7
  assert.deepEqual(produceForDays(WEEK, log), { veg: 3, fruit: 0 });
});

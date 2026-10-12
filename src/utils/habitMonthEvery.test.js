// Every-N-months Monthly habits (`monthEvery` + `monthAnchor`): nothing new
// comes due in an off month, but a cycle left blank stays owed (and in the nav
// badge) through its off months until it's logged.
//
// ⚠️ Mirrors PrepDay/src/utils/habitMonthEvery.test.ts. If one side changes,
// change both.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { habitMonthEvery, habitPeriodKey, monthlyDueIn, tracksDate, countHabitsNeedingLog } from './habitOutstanding.js';

const every3 = { id: 'q', cadence: 'Monthly', monthEvery: 3, monthAnchor: '2026-07' };

describe('every-N-months habits', () => {
  it('reads the interval only on Monthly habits', () => {
    assert.equal(habitMonthEvery(every3), 3);
    assert.equal(habitMonthEvery({ cadence: 'Weekly', monthEvery: 3 }), 1);
    assert.equal(habitMonthEvery({ cadence: 'Monthly' }), 1);
  });

  it('is due in the anchor month and every Nth month either side', () => {
    for (const k of ['2026-01', '2026-04', '2026-07', '2026-10', '2027-01']) assert.equal(monthlyDueIn(every3, k), true, k);
    for (const k of ['2026-05', '2026-06', '2026-08', '2026-09', '2026-12']) assert.equal(monthlyDueIn(every3, k), false, k);
  });

  it('every month when unset or anchorless', () => {
    assert.equal(monthlyDueIn({ cadence: 'Monthly' }, '2026-09'), true);
    assert.equal(monthlyDueIn({ cadence: 'Monthly', monthEvery: 2 }, '2026-09'), true);
  });

  it('an off month is not tracked', () => {
    assert.equal(tracksDate(every3, new Date(2026, 8, 15)), false);
    assert.equal(tracksDate(every3, new Date(2026, 9, 15)), true);
  });

  it('keys an every-N-months habit by its cycle due month', () => {
    assert.equal(habitPeriodKey(every3, new Date(2026, 6, 3)), '2026-07');
    assert.equal(habitPeriodKey(every3, new Date(2026, 7, 3)), '2026-07');
    assert.equal(habitPeriodKey(every3, new Date(2026, 8, 30)), '2026-07');
    assert.equal(habitPeriodKey(every3, new Date(2026, 9, 1)), '2026-10');
    assert.equal(habitPeriodKey(every3, new Date(2027, 0, 9)), '2027-01');
    assert.equal(habitPeriodKey(every3, new Date(2026, 5, 9)), '2026-06'); // before the anchor
    assert.equal(habitPeriodKey({ cadence: 'Monthly' }, new Date(2026, 8, 9)), '2026-09');
  });

  it('a blank cycle stays owed through its off months', () => {
    const sep = new Date(2026, 8, 15);
    const oct = new Date(2026, 9, 15);
    assert.deepEqual(countHabitsNeedingLog([every3], {}, [], sep), { manual: 1, auto: 0 });
    const logged = { '2026-07': { q: 'done' } };
    assert.deepEqual(countHabitsNeedingLog([every3], logged, [], sep), { manual: 0, auto: 0 });
    assert.deepEqual(countHabitsNeedingLog([every3], logged, [], oct), { manual: 1, auto: 0 });
    assert.deepEqual(countHabitsNeedingLog([every3], {}, [], new Date(2026, 5, 15)), { manual: 0, auto: 0 });
    // "Deep Clean": every 2 months from Sep, never logged, now October.
    const deep = { id: 'd', cadence: 'Monthly', monthEvery: 2, monthAnchor: '2026-09' };
    assert.deepEqual(countHabitsNeedingLog([deep], {}, [], new Date(2026, 9, 11)), { manual: 1, auto: 0 });
  });
});

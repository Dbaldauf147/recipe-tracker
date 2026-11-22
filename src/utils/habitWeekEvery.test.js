// Every-N-weeks Weekly habits (`weekEvery` + `weekAnchor`): nothing new comes
// due in an off week, but a cycle left blank stays owed (and in the nav badge)
// through its off weeks until it's logged.
//
// ⚠️ Mirrors PrepDay/src/utils/habitWeekEvery.test.ts. If one side changes,
// change both.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  habitWeekEvery, weeklyDueIn, weekKeyStart, habitPeriodKey, habitDueNow, periodKey, countHabitsNeedingLog,
} from './habitOutstanding.js';
import { ptoCellsToStamp } from './habitPto.js';

// Sun Nov 1 2026 starts the anchor week.
const wk = (y, m, d) => periodKey('Weekly', new Date(y, m, d));
const ANCHOR = wk(2026, 10, 1);
const every2 = { id: 'w', cadence: 'Weekly', weekEvery: 2, weekAnchor: ANCHOR };

describe('every-N-weeks habits', () => {
  it('reads the interval only on Weekly habits', () => {
    assert.equal(habitWeekEvery(every2), 2);
    assert.equal(habitWeekEvery({ cadence: 'Monthly', weekEvery: 3 }), 1);
    assert.equal(habitWeekEvery({ cadence: 'Weekly' }), 1);
    assert.equal(habitWeekEvery({ cadence: 'Weekly', weekEvery: 0 }), 1);
  });

  it('maps a week key back to the Sunday that starts it', () => {
    for (const [y, m, d] of [[2026, 10, 1], [2026, 11, 27], [2027, 0, 3], [2024, 11, 29], [2021, 0, 3]]) {
      const sun = new Date(y, m, d);
      assert.equal(sun.getDay(), 0);
      assert.equal(weekKeyStart(wk(y, m, d)).getTime(), sun.getTime(), `${y}-${m + 1}-${d}`);
      assert.equal(wk(y, m, d + 6), wk(y, m, d));
    }
    assert.equal(weekKeyStart('2026-11'), null);
  });

  it('is due in the anchor week and every Nth week either side, across a year boundary', () => {
    for (let i = -6; i <= 20; i++) assert.equal(weeklyDueIn(every2, wk(2026, 10, 1 + 7 * i)), i % 2 === 0, String(i));
    const every3 = { ...every2, weekEvery: 3 };
    for (let i = 0; i <= 60; i++) assert.equal(weeklyDueIn(every3, wk(2026, 10, 1 + 7 * i)), i % 3 === 0, String(i));
  });

  it('every week when unset or anchorless', () => {
    assert.equal(weeklyDueIn({ cadence: 'Weekly' }, wk(2026, 10, 8)), true);
    assert.equal(weeklyDueIn({ cadence: 'Weekly', weekEvery: 2 }, wk(2026, 10, 8)), true);
  });

  it('keys the habit by its cycle due week', () => {
    assert.equal(habitPeriodKey(every2, new Date(2026, 10, 3)), ANCHOR);
    assert.equal(habitPeriodKey(every2, new Date(2026, 10, 10)), ANCHOR);
    assert.equal(habitPeriodKey(every2, new Date(2026, 10, 15)), wk(2026, 10, 15));
    assert.equal(habitPeriodKey(every2, new Date(2027, 0, 5)), wk(2026, 11, 27));
    assert.equal(habitPeriodKey(every2, new Date(2026, 9, 20)), wk(2026, 9, 20));
    assert.equal(habitPeriodKey({ cadence: 'Weekly' }, new Date(2026, 10, 10)), wk(2026, 10, 10));
  });

  it('a blank cycle stays owed through its off week, then starts fresh', () => {
    const offWeek = new Date(2026, 10, 10);
    const nextDue = new Date(2026, 10, 17);
    assert.equal(habitDueNow(every2, offWeek), true);
    assert.deepEqual(countHabitsNeedingLog([every2], {}, [], offWeek), { manual: 1, auto: 0 });
    const logged = { [ANCHOR]: { w: 'done' } };
    assert.deepEqual(countHabitsNeedingLog([every2], logged, [], offWeek), { manual: 0, auto: 0 });
    assert.deepEqual(countHabitsNeedingLog([every2], logged, [], nextDue), { manual: 1, auto: 0 });
    assert.equal(habitDueNow(every2, new Date(2026, 9, 27)), false);
  });

  it('still waits for a pinned day inside a due week', () => {
    const fri = { ...every2, weekDays: ['friday'] };
    assert.equal(habitDueNow(fri, new Date(2026, 10, 3)), false);
    assert.equal(habitDueNow(fri, new Date(2026, 10, 6)), true);
  });

  it('PTO does not stamp an off week', () => {
    const cells = ptoCellsToStamp([{ ...every2, name: 'x' }], {}, [], [{ start: '2026-11-01', end: '2026-11-14' }], new Date(2026, 10, 20));
    assert.deepEqual(cells.map(c => c.key), [ANCHOR]);
  });
});

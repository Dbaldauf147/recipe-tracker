// Every-N-months Monthly habits (`monthEvery` + `monthAnchor`): off months are
// never due and stay out of the nav badge.
//
// ⚠️ Mirrors PrepDay/src/utils/habitMonthEvery.test.ts. If one side changes,
// change both.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { habitMonthEvery, monthlyDueIn, tracksDate } from './habitOutstanding.js';

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
});

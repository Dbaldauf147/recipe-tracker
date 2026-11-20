// The Bad tab's month-by-month history (badHabits.js badHistoryMonths).
// ⚠️ Same cases as the phone's src/utils/badHistoryMonths.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badHistoryMonths, BAD_STRIP_CHOICES, BAD_STRIP_DEFAULT_DAYS, BAD_MONTHLY_FROM_DAYS } from './badHabits.js';

const months = badHistoryMonths('2026-09-15', '2026-11-20');

test('lists months newest first', () => {
  assert.deepEqual(months.map(m => m.label), ['Nov 2026', 'Oct 2026', 'Sep 2026']);
  assert.deepEqual(months.map(m => m.key), ['2026-11', '2026-10', '2026-09']);
});

test('lays each month out in Sunday-first weeks of seven', () => {
  assert.ok(months.every(m => m.weeks.every(w => w.length === 7)));
  // Nov 1 2026 is a Sunday; Oct 1 2026 a Thursday.
  assert.equal(months[0].weeks[0][0], '2026-11-01');
  assert.deepEqual(months[1].weeks[0].slice(0, 5), [null, null, null, null, '2026-10-01']);
});

test('blanks the days outside the window', () => {
  const nov = months[0].weeks.flat().filter(Boolean);
  assert.equal(nov.length, 20);
  assert.equal(nov[nov.length - 1], '2026-11-20');
  const sep = months[2].weeks.flat().filter(Boolean);
  assert.equal(sep[0], '2026-09-15');
  assert.equal(sep.length, 16);
});

test('crosses a year boundary and rejects an empty window', () => {
  assert.deepEqual(badHistoryMonths('2025-12-30', '2026-01-02').map(m => m.label), ['Jan 2026', 'Dec 2025']);
  assert.deepEqual(badHistoryMonths('2026-11-21', '2026-11-20'), []);
});

test('the default is one of the choices, and months start at 90 days', () => {
  assert.ok(BAD_STRIP_CHOICES.some(c => c.days === BAD_STRIP_DEFAULT_DAYS));
  assert.equal(BAD_MONTHLY_FROM_DAYS, 90);
});

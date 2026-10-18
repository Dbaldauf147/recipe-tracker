import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countHabitStatuses, orderedStatuses, weekStart, recordHabitStatusWeek, mergeMissingWeeks,
  backupsToBackfill, NO_STATUS,
} from './habitStatusHistory.js';

const habits = [
  { id: 1, status: 'Automatically' }, { id: 2, status: ' Automatically ' }, { id: 3, status: 'Havent Started' },
  { id: 4, status: '' }, { id: 5, status: 'Current', habitType: 'bad' }, null, { id: 6, status: 'Custom' },
];

test('counts by status; legacy names folded, bad habits skipped, blank = No status', () => {
  assert.deepEqual(countHabitStatuses(habits), {
    total: 5, counts: { Automatically: 2, 'Not Started': 1, [NO_STATUS]: 1, Custom: 1 },
  });
});

test('stack order: known statuses first, others A→Z, No status last', () => {
  assert.deepEqual(orderedStatuses([NO_STATUS, 'Zed', 'On Hold', 'Current', 'Alpha']), ['Current', 'On Hold', 'Alpha', 'Zed', NO_STATUS]);
});

test('weeks start on the local Sunday', () => {
  assert.equal(weekStart(new Date(2026, 9, 18)), '2026-10-18'); // Sunday
  assert.equal(weekStart(new Date(2026, 9, 24, 23, 30)), '2026-10-18'); // Saturday night
  assert.equal(weekStart(new Date(2026, 9, 25)), '2026-10-25');
});

test('rewrites only the current week, and only when counts move', () => {
  const now = new Date(2026, 9, 20);
  const old = [{ week: '2026-10-11', total: 1, counts: { Current: 1 } }];
  const first = recordHabitStatusWeek(old, habits, now);
  assert.equal(first.changed, true);
  assert.deepEqual(first.history.map(r => r.week), ['2026-10-11', '2026-10-18']);
  // Same counts in a different key order (as Firestore returns them) → no write.
  const row = first.history[1];
  const reordered = [old[0], { ...row, counts: Object.fromEntries(Object.entries(row.counts).reverse()) }];
  assert.equal(recordHabitStatusWeek(reordered, habits, now).changed, false);
  const moved = recordHabitStatusWeek(first.history, [...habits, { status: 'Rarely' }], now);
  assert.equal(moved.history.length, 2);
  assert.equal(moved.history[1].counts.Rarely, 1);
  assert.deepEqual(moved.history[0], old[0]);
});

test('backfill: latest backup per missing week; recorded weeks win', () => {
  const todo = backupsToBackfill(
    [{ id: 'a', date: '2026-10-05' }, { id: 'b', date: '2026-10-09' }, { id: 'c', date: '2026-10-12' }, { id: 'x', date: 'junk' }],
    [{ week: '2026-10-11' }],
  );
  assert.deepEqual(todo.map(t => [t.week, t.backup.id]), [['2026-10-04', 'b']]);
  const { history, added } = mergeMissingWeeks([{ week: '2026-10-11', total: 9 }], [{ week: '2026-10-11', total: 1 }, { week: '2026-10-04', total: 3 }]);
  assert.equal(added, 1);
  assert.deepEqual(history.map(r => [r.week, r.total]), [['2026-10-04', 3], ['2026-10-11', 9]]);
});

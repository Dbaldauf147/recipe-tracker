import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countHabitStatuses, orderedStatuses, weekStart, recordHabitStatusWeek, mergeMissingWeeks,
  backupsToBackfill, NO_STATUS,
  habitsWithStatus, backupForWeek, normalizeChartPrefs, statusHistoryColor,
} from './habitStatusHistory.js';

test('chart prefs keep valid colours and hidden statuses, drop the rest', () => {
  const p = normalizeChartPrefs({ colors: { 'Most Days': '#123abc', Rarely: 'red' }, hidden: ['On Hold', 'On Hold', 3] });
  assert.deepEqual(p.colors, { 'Most Days': '#123abc' });
  assert.deepEqual(p.hidden, ['On Hold']);
  assert.deepEqual(normalizeChartPrefs(null), { colors: {}, hidden: [] });
  assert.deepEqual(normalizeChartPrefs([1]), { colors: {}, hidden: [] });
});

test('statusHistoryColor uses an override, else the default', () => {
  assert.equal(statusHistoryColor('Most Days', { 'Most Days': '#000000' }), '#000000');
  assert.equal(statusHistoryColor('Most Days', { 'Most Days': 'nope' }), '#65a30d');
  assert.equal(statusHistoryColor('Most Days'), '#65a30d');
});

test('habitsWithStatus matches the counting rules (legacy names, blanks, no bad habits)', () => {
  const habits = [
    { id: 'a', status: 'Most Days' },
    { id: 'b', status: 'Tracked' },
    { id: 'c', status: '' },
    { id: 'd', status: 'Most Days', habitType: 'bad' },
  ];
  assert.deepEqual(habitsWithStatus(habits, 'Most Days').map(h => h.id), ['a', 'b']);
  assert.deepEqual(habitsWithStatus(habits, 'No status').map(h => h.id), ['c']);
});

test('backupForWeek picks the newest backup inside that Sunday-Saturday week', () => {
  const backups = [
    { id: 'x', date: '2026-10-05' }, { id: 'y', date: '2026-10-10' }, { id: 'z', date: '2026-10-11' },
  ];
  assert.equal(backupForWeek(backups, '2026-10-04').id, 'y');
  assert.equal(backupForWeek(backups, '2026-10-11').id, 'z');
  assert.equal(backupForWeek(backups, '2026-09-27'), null);
});

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

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  weekStart, countStages, stageSnapshot, sameCounts, upsertWeek,
  recordStageWeek, mergeMissingWeeks, formatWeekLabel, backupsToBackfill, backfilledRow,
  countCommonByCategory, monthlyCommonStages,
} from './recipeStageHistory.js';

// A Wednesday, mid-afternoon local.
const WED = new Date(2026, 8, 23, 15, 0, 0);

test('weekStart snaps to the Sunday that starts the week', () => {
  assert.equal(weekStart(WED), '2026-09-20');
  assert.equal(weekStart(new Date(2026, 8, 20, 0, 1)), '2026-09-20'); // Sunday itself
  assert.equal(weekStart(new Date(2026, 8, 26, 23, 59)), '2026-09-20'); // Saturday
  assert.equal(weekStart(new Date(2026, 8, 27, 0, 0)), '2026-09-27'); // next Sunday
});

test('weekStart uses local parts, so a late Saturday stays in its own week', () => {
  // The UTC one-liner returns the next day west of UTC from evening onwards;
  // this must not roll the week over with it.
  assert.equal(weekStart(new Date(2026, 8, 26, 22, 30)), '2026-09-20');
});

test('countStages tallies each stage and everything unset', () => {
  const counts = countStages([
    { devStage: 'new' },
    { devStage: 'wip' },
    { devStage: 'wip' },
    { devStage: 'nailed' },
    { devStage: '' },
    {},
    { devStage: 'bogus' },
  ]);
  assert.deepEqual(counts, { total: 7, unset: 3, new: 1, wip: 2, nailed: 1 });
});

test('countStages leaves linked recipes out entirely', () => {
  const counts = countStages([
    { devStage: 'nailed' },
    { devStage: 'nailed', source: 'shared-link' },
  ]);
  assert.equal(counts.total, 1);
  assert.equal(counts.nailed, 1);
});

test('countStages tolerates junk', () => {
  assert.equal(countStages().total, 0);
  assert.equal(countStages([null, undefined]).total, 0);
});

test('upsertWeek replaces the row for a week and keeps the list sorted', () => {
  let history = upsertWeek([], { week: '2026-09-20', nailed: 1 });
  history = upsertWeek(history, { week: '2026-09-06', nailed: 3 });
  history = upsertWeek(history, { week: '2026-09-20', nailed: 2 });
  assert.deepEqual(history.map(r => r.week), ['2026-09-06', '2026-09-20']);
  assert.equal(history[1].nailed, 2);
});

test('recordStageWeek rewrites this week in place while the counts move', () => {
  const first = recordStageWeek([], [{ devStage: 'wip' }], WED);
  assert.equal(first.changed, true);
  assert.equal(first.history.length, 1);

  const second = recordStageWeek(
    first.history,
    [{ devStage: 'wip' }, { devStage: 'nailed' }],
    new Date(2026, 8, 24, 9, 0)
  );
  assert.equal(second.changed, true);
  assert.equal(second.history.length, 1, 'same week — one row, not two');
  assert.equal(second.history[0].nailed, 1);
});

test('recordStageWeek is a no-op when nothing changed', () => {
  const first = recordStageWeek([], [{ devStage: 'wip' }], WED);
  const again = recordStageWeek(first.history, [{ devStage: 'wip' }], new Date(2026, 8, 25));
  assert.equal(again.changed, false);
  assert.equal(again.history, first.history, 'same array — no Firestore write');
});

test('recordStageWeek starts a new row once the week rolls over', () => {
  const first = recordStageWeek([], [{ devStage: 'wip' }], WED);
  const next = recordStageWeek(first.history, [{ devStage: 'nailed' }], new Date(2026, 8, 28));
  assert.deepEqual(next.history.map(r => r.week), ['2026-09-20', '2026-09-27']);
  assert.equal(next.history[0].wip, 1, 'the finished week stays frozen');
});

test('sameCounts ignores recordedAt', () => {
  const a = stageSnapshot([{ devStage: 'new' }], WED);
  const b = stageSnapshot([{ devStage: 'new' }], new Date(2026, 8, 24));
  assert.equal(sameCounts(a, b), true);
  assert.equal(sameCounts(a, stageSnapshot([{ devStage: 'wip' }], WED)), false);
});

test('mergeMissingWeeks never overwrites a week already recorded', () => {
  const live = [{ week: '2026-09-20', total: 10, unset: 0, new: 1, wip: 2, nailed: 7 }];
  const { history, added } = mergeMissingWeeks(live, [
    { week: '2026-09-06', total: 8, unset: 8, new: 0, wip: 0, nailed: 0 },
    { week: '2026-09-20', total: 99, unset: 99, new: 0, wip: 0, nailed: 0 },
  ]);
  assert.equal(added, 1);
  assert.deepEqual(history.map(r => r.week), ['2026-09-06', '2026-09-20']);
  assert.equal(history[1].total, 10, 'the live row wins');
});

test('formatWeekLabel prints the week`s Sunday', () => {
  assert.equal(formatWeekLabel('2026-09-20', { year: false }), 'Sep 20');
  assert.equal(formatWeekLabel('2025-01-05', { year: true }), 'Jan 5, 2025');
  assert.equal(formatWeekLabel(''), '');
});

test('backupsToBackfill keeps the last backup of each week and skips known weeks', () => {
  const backups = [
    { id: 'full-2026-09-08', date: '2026-09-08' }, // week of Sep 6
    { id: 'full-2026-09-11', date: '2026-09-11' }, // week of Sep 6 — later, wins
    { id: 'full-2026-09-15', date: '2026-09-15' }, // week of Sep 13
    { id: 'full-2026-09-22', date: '2026-09-22' }, // week of Sep 20 — already have
    { id: 'full-server-broken', date: 'nonsense' },
  ];
  const out = backupsToBackfill(backups, [{ week: '2026-09-20' }]);
  assert.deepEqual(out.map(o => [o.week, o.backup.id]), [
    ['2026-09-06', 'full-2026-09-11'],
    ['2026-09-13', 'full-2026-09-15'],
  ]);
});

test('backfilledRow counts the snapshot and marks where it came from', () => {
  const row = backfilledRow('2026-09-06', [{ devStage: 'wip' }, {}], { date: '2026-09-11' });
  assert.equal(row.week, '2026-09-06');
  assert.equal(row.wip, 1);
  assert.equal(row.unset, 1);
  assert.equal(row.source, 'backup');
});

test('countCommonByCategory counts only common recipes, per category, with the list defaults', () => {
  const c = countCommonByCategory([
    { category: 'breakfast', devStage: 'nailed' },
    { category: 'breakfast', frequency: 'common', devStage: 'wip' },
    { category: 'breakfast', frequency: 'rare', devStage: 'nailed' },     // not common
    { category: 'breakfast', frequency: 'toTry' },                        // not common
    { devStage: 'nailed' },                                               // no category → lunch-dinner
    { category: 'lunch-dinner', devStage: 'new' },
    { category: 'snacks', devStage: 'nailed' },                           // not broken out
    { category: 'breakfast', devStage: 'nailed', source: 'shared-link' }, // linked
  ]);
  assert.deepEqual(c.breakfast, { total: 2, unset: 0, new: 0, wip: 1, nailed: 1 });
  assert.deepEqual(c['lunch-dinner'], { total: 2, unset: 0, new: 1, wip: 0, nailed: 1 });
});

test('a row without the breakdown differs, so this week picks it up', () => {
  const withIt = stageSnapshot([{ devStage: 'new' }], WED);
  const { common, ...without } = withIt;
  assert.ok(common);
  assert.equal(sameCounts(without, withIt), false);
});

test('mergeMissingWeeks fills the breakdown into a recorded week without touching its counts', () => {
  const live = [{ week: '2026-09-20', total: 10, unset: 0, new: 1, wip: 2, nailed: 7 }];
  const common = countCommonByCategory([{ category: 'breakfast', devStage: 'wip' }]);
  const { history, added, filled } = mergeMissingWeeks(live, [
    { week: '2026-09-20', total: 99, unset: 99, new: 0, wip: 0, nailed: 0, common },
  ]);
  assert.equal(added, 0);
  assert.equal(filled, 1);
  assert.equal(history[0].total, 10, 'counts stay the live ones');
  assert.deepEqual(history[0].common, common);
});

test('monthlyCommonStages takes the last reading of each month, and live for this month', () => {
  const at = (n) => countCommonByCategory(Array.from({ length: n }, () => ({ category: 'breakfast', devStage: 'nailed' })));
  const history = [
    { week: '2026-07-05', recordedAt: '2026-07-08T10:00:00.000Z', common: at(1) },
    { week: '2026-07-26', recordedAt: '2026-07-30T10:00:00.000Z', common: at(2) }, // July ends here
    { week: '2026-08-30', recordedAt: '2026-08-31T10:00:00.000Z' },               // no breakdown → ignored
    { week: '2026-09-06', recordedAt: '2026-09-07T10:00:00.000Z', common: at(4) },
  ];
  const out = monthlyCommonStages(history, { now: new Date(2026, 9, 3), months: 12, live: at(5) });
  assert.deepEqual(out.map(p => p.month), ['2026-07', '2026-08', '2026-09', '2026-10'], 'leading empty months trimmed');
  assert.deepEqual(out.map(p => p.counts ? p.counts.breakfast.total : null), [2, null, 4, 5], 'a gap stays null, not 0');
  assert.deepEqual(monthlyCommonStages([], { now: new Date(2026, 9, 3) }), []);
});

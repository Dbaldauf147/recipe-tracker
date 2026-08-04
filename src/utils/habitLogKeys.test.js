import test from 'node:test';
import assert from 'node:assert/strict';
import {
  yearOfPeriodKey, splitByYear, yearsForKeys, mergeYearDocs,
  parseYearDoc, countMarks, mergeLogs, cellsByYear, applyCells, diffCells,
} from './habitLogKeys.js';

// These functions decide which year document a mark is written to and read
// back from. Get one wrong and marks land in a year nobody reads — the history
// looks like it vanished, with no error anywhere.

// The four key shapes HabitsPage.periodKey can produce (mirrored in the mobile
// app's HabitsScreen and in api/run-habit-automations.js). All four are
// year-first, which is the property the whole year-document scheme rests on.
test('yearOfPeriodKey handles every cadence key shape', () => {
  assert.equal(yearOfPeriodKey('2026-07-28'), '2026');   // daily   — dayKey()
  assert.equal(yearOfPeriodKey('2026-W31'), '2026');     // weekly  — isoWeekKey()
  assert.equal(yearOfPeriodKey('2026-07'), '2026');      // monthly
  assert.equal(yearOfPeriodKey('2026'), '2026');         // annual
  assert.equal(yearOfPeriodKey('2014-01-01'), '2014');   // oldest history
});

// An ISO week key carries the ISO WEEK year, which around New Year disagrees
// with the calendar year of the days in it (29 Dec 2025 falls in 2026-W01).
// That's fine and must stay that way: the key is the mark's identity, and both
// the writer and the reader derive the year from the key itself, so the mark
// always lands in and comes back from the same document.
test('ISO week keys file under their own week-year, consistently', () => {
  assert.equal(yearOfPeriodKey('2026-W01'), '2026');
  assert.equal(yearOfPeriodKey('2025-W52'), '2025');
  const log = { '2026-W01': { h1: 'done' }, '2025-W52': { h1: 'done' } };
  const byYear = splitByYear(log);
  assert.deepEqual(Object.keys(byYear).sort(), ['2025', '2026']);
  assert.deepEqual(mergeYearDocs(byYear), log);
});

test('yearOfPeriodKey rejects junk rather than misfiling it', () => {
  for (const bad of ['', null, undefined, 'notakey', '26-07-28', '20267-01', 'habit-3f9a']) {
    assert.equal(yearOfPeriodKey(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('splitByYear buckets by year and drops empty/junk rows', () => {
  const log = {
    '2025-12-31': { h1: 'done' },
    '2026-01-01': { h1: 'done', h2: 'skipped' },
    '2026-W31': { h3: 'done' },
    '2026-07': {},              // empty bucket → dropped
    'garbage': { h1: 'done' },  // unparseable key → dropped
  };
  const out = splitByYear(log);
  assert.deepEqual(Object.keys(out).sort(), ['2025', '2026']);
  assert.deepEqual(out['2025'], { '2025-12-31': { h1: 'done' } });
  assert.deepEqual(Object.keys(out['2026']).sort(), ['2026-01-01', '2026-W31']);
});

test('yearsForKeys returns the distinct years a write must rewrite', () => {
  assert.deepEqual(yearsForKeys(['2026-07-28', '2026-07-29', '2025-01-02']).sort(), ['2025', '2026']);
  assert.deepEqual(yearsForKeys([]), []);
  assert.deepEqual(yearsForKeys(['junk']), []);
});

test('mergeYearDocs reassembles the whole log', () => {
  const merged = mergeYearDocs({
    '2026': { '2026-01-01': { h1: 'done' } },
    '2025': { '2025-12-31': { h1: 'skipped' } },
  });
  assert.deepEqual(merged, {
    '2025-12-31': { h1: 'skipped' },
    '2026-01-01': { h1: 'done' },
  });
});

test('parseYearDoc reads the JSON string, tolerates a map, survives corruption', () => {
  assert.deepEqual(parseYearDoc({ marks: '{"2026-01-01":{"h1":"done"}}' }), { '2026-01-01': { h1: 'done' } });
  assert.deepEqual(parseYearDoc({ marks: { '2026-01-01': { h1: 'done' } } }), { '2026-01-01': { h1: 'done' } });
  assert.deepEqual(parseYearDoc({ marks: 'not json{' }), {});
  assert.deepEqual(parseYearDoc({ marks: '"a string"' }), {});
  assert.deepEqual(parseYearDoc(null), {});
  assert.deepEqual(parseYearDoc({}), {});
});

test('countMarks totals cells, not period keys', () => {
  assert.equal(countMarks({ '2026-01-01': { h1: 'done', h2: 'done' }, '2026-01-02': { h1: 'skipped' } }), 3);
  assert.equal(countMarks({}), 0);
  assert.equal(countMarks(null), 0);
});

test('mergeLogs merges per CELL, never replacing a whole day', () => {
  const base = { '2026-01-01': { h1: 'done', h2: 'skipped' } };
  const overlay = { '2026-01-01': { h2: 'done', h3: 'missed' } };
  assert.deepEqual(mergeLogs(base, overlay), {
    // h1 survives even though the overlay says nothing about it — a shallow
    // spread of the day bucket would have dropped it.
    '2026-01-01': { h1: 'done', h2: 'done', h3: 'missed' },
  });
});

test('mergeLogs leaves the inputs untouched', () => {
  const base = { '2026-01-01': { h1: 'done' } };
  const overlay = { '2026-01-01': { h2: 'done' } };
  mergeLogs(base, overlay);
  assert.deepEqual(base, { '2026-01-01': { h1: 'done' } });
  assert.deepEqual(overlay, { '2026-01-01': { h2: 'done' } });
});

// --- cell-level writes -------------------------------------------------------
// These three are what keep two writers from overwriting each other. The app and
// the hourly automation cron both write the same year document; whoever wrote
// their whole copy of the year last used to win, silently deleting the other's
// marks. Everything below exists to make a write say only what it changed.

test('cellsByYear groups cells by document and drops unfilable ones', () => {
  const out = cellsByYear([
    { key: '2026-08-03', habitId: 'h1', mark: 'done' },
    { key: '2026-W31', habitId: 'h2', mark: null },
    { key: '2025-12-31', habitId: 'h1', mark: 'done' },
    { key: 'garbage', habitId: 'h1', mark: 'done' },   // unparseable key
    { key: '2026-08-03', mark: 'done' },               // no habitId
  ]);
  assert.deepEqual(Object.keys(out).sort(), ['2025', '2026']);
  assert.equal(out['2026'].length, 2);
  assert.equal(out['2025'].length, 1);
});

test('applyCells sets, erases, and drops a bucket left empty', () => {
  const part = { '2026-08-03': { h1: 'done', h2: 'skipped' }, '2026-08-04': { h1: 'done' } };
  const out = applyCells(part, [
    { key: '2026-08-03', habitId: 'h2', mark: 'exceeded' }, // change
    { key: '2026-08-05', habitId: 'h9', mark: 'done' },     // brand new day
    { key: '2026-08-04', habitId: 'h1', mark: null },       // erase, emptying the day
  ]);
  assert.deepEqual(out, {
    '2026-08-03': { h1: 'done', h2: 'exceeded' },
    '2026-08-05': { h9: 'done' },
  });
  // The input is untouched — callers hold it as React state.
  assert.deepEqual(part['2026-08-04'], { h1: 'done' });
});

// The actual regression. On 2026-08-03 the cron auto-marked the Workout habit
// while a Habits tab opened that morning still held a log without it. The tab's
// next tap wrote its whole copy of 2026 back and the ✓ vanished — and because
// habitLogAuto still recorded the mark, the cron then read the empty cell as a
// deliberate erase and refused to refill it, permanently.
test('a concurrent writer\'s mark survives a cell write', () => {
  const asLoadedByTheTab = { '2026-08-03': { habitA: 'done' } };
  // The cron writes the workout ✓ after the tab loaded.
  const onTheServer = applyCells(asLoadedByTheTab, [
    { key: '2026-08-03', habitId: 'workout', mark: 'done' },
  ]);
  // Now the tab marks something else. It only says what IT changed.
  const afterTheTap = applyCells(onTheServer, [
    { key: '2026-08-03', habitId: 'habitB', mark: 'skipped' },
  ]);
  assert.equal(afterTheTap['2026-08-03'].workout, 'done', 'the auto-marked workout survived');
  assert.deepEqual(afterTheTap['2026-08-03'], { habitA: 'done', workout: 'done', habitB: 'skipped' });
});

test('diffCells reports only what changed, erases included', () => {
  const base = { '2026-08-03': { h1: 'done', h2: 'skipped' }, '2026-08-04': { h1: 'done' } };
  const next = { '2026-08-03': { h1: 'done', h2: 'exceeded', h3: 'done' } };
  const cells = diffCells(next, base);
  const sorted = [...cells].sort((a, b) => `${a.key}${a.habitId}`.localeCompare(`${b.key}${b.habitId}`));
  assert.deepEqual(sorted, [
    { key: '2026-08-03', habitId: 'h2', mark: 'exceeded' },
    { key: '2026-08-03', habitId: 'h3', mark: 'done' },
    { key: '2026-08-04', habitId: 'h1', mark: null },  // the whole day went away
  ]);
  assert.deepEqual(diffCells(base, base), [], 'an unchanged log writes nothing');
});

test('diffCells + applyCells reproduce the writer\'s intent exactly', () => {
  const base = { '2026-08-03': { h1: 'done' }, '2026-W31': { h2: 'skipped' } };
  const next = { '2026-08-03': { h1: 'exceeded', h4: 'done' }, '2026': { h3: 'done' } };
  assert.deepEqual(applyCells(base, diffCells(next, base)), next);
});

test('a full-size history round-trips through split → serialise → parse → merge', () => {
  // Roughly the real shape: 13 years, 50 habits, daily marks.
  const MARKS = ['done', 'skipped', 'missed', 'exceeded'];
  const log = {};
  let expected = 0;
  for (let y = 2014; y <= 2026; y++) {
    for (let doy = 0; doy < 365; doy += 5) {
      const d = new Date(Date.UTC(y, 0, 1 + doy));
      const key = d.toISOString().slice(0, 10);
      const bucket = {};
      for (let h = 0; h < 50; h++) {
        bucket[`h-${h}`] = MARKS[(y + doy + h) % MARKS.length];
        expected++;
      }
      log[key] = bucket;
    }
    log[`${y}`] = { 'h-annual': 'done' };            // annual cadence key
    log[`${y}-W07`] = { 'h-weekly': 'skipped' };     // weekly cadence key
    log[`${y}-03`] = { 'h-monthly': 'done' };        // monthly cadence key
    expected += 3;
  }
  assert.equal(countMarks(log), expected);

  const byYear = splitByYear(log);
  assert.deepEqual(Object.keys(byYear).sort(), Array.from({ length: 13 }, (_, i) => String(2014 + i)));

  // Every year survives the JSON-string encoding the year document uses.
  const roundTripped = {};
  let biggest = 0;
  for (const year of Object.keys(byYear)) {
    const serialised = JSON.stringify(byYear[year]);
    // Marks and keys are ASCII, so character count is the byte count here.
    biggest = Math.max(biggest, serialised.length);
    roundTripped[year] = parseYearDoc({ marks: serialised, v: 1 });
  }

  const merged = mergeYearDocs(roundTripped);
  assert.equal(countMarks(merged), expected, 'no marks lost in the round trip');
  assert.deepEqual(merged, log, 'the reassembled log is identical to the original');

  // The whole point of splitting: each document stays far under Firestore's
  // 1 MiB cap, and a single mark rewrites only its own year.
  assert.ok(biggest < 1_000_000, `largest year document was ${biggest} bytes`);
});

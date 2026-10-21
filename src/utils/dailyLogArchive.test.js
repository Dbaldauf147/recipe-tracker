import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARCHIVE_AFTER_DAYS, shiftDayKey, archiveCutoff, stableStringify, sameDay,
  mergeArchivedDay, parseArchiveDoc, buildArchiveDoc, flattenArchive,
  mergeArchiveUnder, omitArchivedDays, planArchiveSweep,
} from './dailyLogArchive.js';

// The monthly dailyLog archive. What matters: no sweep, merge or save can lose
// a logged meal, and a client save never drags archived history back into the
// live doc.

const meal = (id, extra = {}) => ({ id, recipeName: id, nutrition: { calories: 100 }, ...extra });

test('day-key arithmetic crosses months and years', () => {
  assert.equal(shiftDayKey('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDayKey('2026-01-01', -1), '2025-12-31');
  assert.equal(archiveCutoff('2026-10-21'), shiftDayKey('2026-10-21', -ARCHIVE_AFTER_DAYS));
  assert.equal(archiveCutoff('2026-10-21', 60), '2026-08-22');
});

test('stableStringify ignores key order, keeps array order', () => {
  assert.equal(stableStringify({ b: 1, a: { d: 2, c: 3 } }), stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  assert.notEqual(stableStringify([1, 2]), stableStringify([2, 1]));
  assert.ok(sameDay({ entries: [meal('x')], steps: 5 }, { steps: 5, entries: [meal('x')] }));
});

test('a newer copy wins field by field', () => {
  const out = mergeArchivedDay({ entries: [meal('a')], steps: 1 }, { entries: [meal('b')], sleep: 7 });
  assert.deepEqual(out, { entries: [meal('b')], steps: 1, sleep: 7 });
});

test('an empty-entries stub never wipes archived meals', () => {
  // The phone's Apple Health backfill writes exactly this for old dates.
  const out = mergeArchivedDay({ entries: [meal('a')], steps: 1 }, { entries: [], steps: 900, sleep: 6 });
  assert.deepEqual(out.entries, [meal('a')]);
  assert.equal(out.steps, 900);
});

test('archive docs round-trip through a JSON string', () => {
  const log = { '2026-06-02': { entries: [meal('b')] }, '2026-06-01': { entries: [meal('a'), meal('c')] } };
  const d = buildArchiveDoc('2026-06', log, new Date('2026-10-21T08:00:00Z'));
  assert.equal(typeof d.log, 'string');
  assert.equal(d.days, 2);
  assert.equal(d.entries, 3);
  assert.deepEqual(parseArchiveDoc(d), log);
  assert.deepEqual(parseArchiveDoc(null), {});
  assert.deepEqual(parseArchiveDoc({ log: 'not json' }), {});
});

test('clients see archive under live, live copy merged on top', () => {
  const archive = flattenArchive({
    '2026-06': { '2026-06-01': { entries: [meal('a')] } },
    '2026-07': { '2026-07-01': { entries: [meal('b')], steps: 1 } },
  });
  const live = { '2026-07-01': { entries: [], steps: 2 }, '2026-10-20': { entries: [meal('c')] } };
  const full = mergeArchiveUnder(archive, live);
  assert.deepEqual(Object.keys(full).sort(), ['2026-06-01', '2026-07-01', '2026-10-20']);
  assert.deepEqual(full['2026-07-01'], { entries: [meal('b')], steps: 2 });
});

test('a save leaves out archived days unless they changed', () => {
  const archive = { '2026-06-01': { entries: [meal('a')] }, '2026-06-02': { entries: [meal('b')] } };
  const log = {
    '2026-06-01': { entries: [meal('a')] },                 // unchanged → omitted
    '2026-06-02': { entries: [meal('b'), meal('new')] },    // edited → written
    '2026-10-20': { entries: [meal('c')] },                 // recent → written
  };
  assert.deepEqual(Object.keys(omitArchivedDays(log, archive)).sort(), ['2026-06-02', '2026-10-20']);
});

test('no archive → a save writes everything', () => {
  const log = { '2026-06-01': { entries: [meal('a')] } };
  assert.equal(omitArchivedDays(log, null), log);
  assert.equal(omitArchivedDays(log, {}), log);
});

test('sweep files only days before the cutoff, grouped by month', () => {
  const live = {
    '2026-06-05': { entries: [meal('a')] },
    '2026-07-31': { entries: [meal('b')] },
    '2026-08-21': { steps: 3 },
    '2026-08-22': { entries: [meal('keep')] },  // == cutoff → stays live
    '2026-11-01': { entries: [meal('future')] },
    junk: { entries: [meal('j')] },
  };
  const plan = planArchiveSweep(live, {}, '2026-10-21', 60);
  assert.equal(plan.cutoff, '2026-08-22');
  assert.deepEqual(Object.keys(plan.months).sort(), ['2026-06', '2026-07', '2026-08']);
  assert.deepEqual(plan.months['2026-08'].days, ['2026-08-21']);
});

test('sweep merges into an existing month without losing its days', () => {
  const existing = { '2026-06': { '2026-06-01': { entries: [meal('old')] }, '2026-06-05': { entries: [meal('a')] } } };
  const live = { '2026-06-05': { entries: [], steps: 10 } };   // a resurrected stub
  const m = planArchiveSweep(live, existing, '2026-10-21', 60).months['2026-06'].log;
  assert.deepEqual(m['2026-06-01'].entries, [meal('old')]);
  assert.deepEqual(m['2026-06-05'], { entries: [meal('a')], steps: 10 });
});

test('round trip: sweep → client load → client save sends only recent days', () => {
  const live = {
    '2026-06-05': { entries: [meal('a')] },
    '2026-10-20': { entries: [meal('c')] },
  };
  const plan = planArchiveSweep(live, {}, '2026-10-21', 60);
  const archive = flattenArchive({ '2026-06': parseArchiveDoc(buildArchiveDoc('2026-06', plan.months['2026-06'].log)) });
  const remaining = { '2026-10-20': live['2026-10-20'] };
  const clientLog = mergeArchiveUnder(archive, remaining);
  assert.deepEqual(clientLog, live);
  assert.deepEqual(omitArchivedDays(clientLog, archive), remaining);
});

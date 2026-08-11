import test from 'node:test';
import assert from 'node:assert/strict';
import {
  withFieldOp, withMarkOps, withAttempt, dropOps,
  applyOps, applyCellsToLog, mergeHabits,
  pendingCountOf, failedCountOf, livingOps,
} from './habitOfflineQueue.js';

// These rules decide whether an edit made with no connection survives. A wrong
// one loses work silently — the page would look like it saved either way.

let n = 0;
const makeId = () => `op${++n}`;
test.beforeEach(() => { n = 0; });

// ---- collapsing -------------------------------------------------------------

test('a second write to the same field replaces the first, keeping its baseline', () => {
  const base = [{ id: 'h1', name: 'Run' }];
  let q = withFieldOp([], { id: 'a', field: 'habits', value: [{ id: 'h1', name: 'Run 5k' }], baseline: base });
  q = withFieldOp(q, { id: 'b', field: 'habits', value: [{ id: 'h1', name: 'Run 10k' }], baseline: null });
  assert.equal(q.length, 1);
  assert.equal(q[0].value[0].name, 'Run 10k');
  // The baseline must stay the ORIGINAL — it's what the server had before any
  // of this. Taking the later one would merge against our own edit.
  assert.deepEqual(q[0].baseline, base);
});

test('different fields queue separately', () => {
  let q = withFieldOp([], { id: 'a', field: 'habits', value: [1] });
  q = withFieldOp(q, { id: 'b', field: 'habitNextLog', value: { Weekly: '2026-08-16' } });
  assert.equal(q.length, 2);
});

test('marking then unmarking the same cell collapses to one op', () => {
  let q = withMarkOps([], [{ key: '2026-08-11', habitId: 'h1', mark: 'done' }], 'manual', makeId);
  q = withMarkOps(q, [{ key: '2026-08-11', habitId: 'h1', mark: null }], 'manual', makeId);
  assert.equal(q.length, 1);
  assert.equal(q[0].mark, null);
});

test('manual and auto marks for one cell stay separate ops', () => {
  let q = withMarkOps([], [{ key: '2026-08-11', habitId: 'h1', mark: 'done' }], 'manual', makeId);
  q = withMarkOps(q, [{ key: '2026-08-11', habitId: 'h1', mark: null }], 'auto', makeId);
  assert.equal(q.length, 2);
  assert.deepEqual(q.map(o => o.kind), ['manual', 'auto']);
});

test('a bulk import collapses against what is already queued', () => {
  let q = withMarkOps([], [{ key: '2026-08-10', habitId: 'h1', mark: 'skipped' }], 'manual', makeId);
  q = withMarkOps(q, [
    { key: '2026-08-10', habitId: 'h1', mark: 'done' },   // same cell → collapse
    { key: '2026-08-10', habitId: 'h2', mark: 'done' },   // new cell → append
  ], 'manual', makeId);
  assert.equal(q.length, 2);
  assert.equal(q.find(o => o.habitId === 'h1').mark, 'done');
});

// ---- giving up --------------------------------------------------------------

test('an op is only abandoned after the attempt cap', () => {
  let q = withMarkOps([], [{ key: '2026', habitId: 'h1', mark: 'done' }], 'manual', makeId);
  const ids = new Set(q.map(o => o.id));
  for (let i = 0; i < 4; i++) q = withAttempt(q, ids, 5);
  assert.equal(pendingCountOf(q), 1, 'still pending at 4 attempts');
  assert.equal(failedCountOf(q), 0);
  q = withAttempt(q, ids, 5);
  assert.equal(pendingCountOf(q), 0, 'abandoned at the cap');
  assert.equal(failedCountOf(q), 1);
});

test('a failed op is skipped by collapse, so a later edit queues fresh', () => {
  let q = withMarkOps([], [{ key: '2026', habitId: 'h1', mark: 'done' }], 'manual', makeId);
  q = q.map(op => ({ ...op, failed: true }));
  q = withMarkOps(q, [{ key: '2026', habitId: 'h1', mark: 'skipped' }], 'manual', makeId);
  assert.equal(q.length, 2);
  assert.equal(pendingCountOf(q), 1);
  assert.equal(livingOps(q)[0].mark, 'skipped');
});

test('dropOps removes exactly the confirmed ops', () => {
  const q = withMarkOps([], [
    { key: '2026-08-11', habitId: 'h1', mark: 'done' },
    { key: '2026-08-11', habitId: 'h2', mark: 'done' },
  ], 'manual', makeId);
  const left = dropOps(q, new Set([q[0].id]));
  assert.equal(left.length, 1);
  assert.equal(left[0].habitId, 'h2');
});

// ---- replay over a server snapshot -----------------------------------------

test('queued marks survive a server snapshot that predates them', () => {
  const q = withMarkOps([], [{ key: '2026-08-11', habitId: 'h1', mark: 'done' }], 'manual', makeId);
  const loaded = { habits: [{ id: 'h1' }], habitLog: { '2026-08-11': { h2: 'done' } }, habitLogAuto: {} };
  const out = applyOps(loaded, q);
  assert.equal(out.habitLog['2026-08-11'].h1, 'done', 'our mark wins');
  assert.equal(out.habitLog['2026-08-11'].h2, 'done', "someone else's mark is kept");
});

test('a queued erase removes the cell, and an emptied bucket goes with it', () => {
  const q = withMarkOps([], [{ key: '2026-08-11', habitId: 'h1', mark: null }], 'manual', makeId);
  const out = applyOps({ habitLog: { '2026-08-11': { h1: 'done' } } }, q);
  assert.equal(out.habitLog['2026-08-11'], undefined);
});

test('replay with an empty queue returns the snapshot untouched', () => {
  const loaded = { habits: [{ id: 'h1' }], habitLog: { x: { h1: 'done' } } };
  assert.equal(applyOps(loaded, []), loaded);
});

// ---- the habits three-way merge --------------------------------------------

test('an edit made offline lands on top of a habit the phone changed', () => {
  const baseline = [{ id: 'h1', name: 'Run', status: 'Most Days' }, { id: 'h2', name: 'Read', status: 'Most Days' }];
  const local = [{ id: 'h1', name: 'Run', status: 'On Hold' }, { id: 'h2', name: 'Read', status: 'Most Days' }];
  // Meanwhile the phone renamed h2.
  const remote = [{ id: 'h1', name: 'Run', status: 'Most Days' }, { id: 'h2', name: 'Read 20 pages', status: 'Most Days' }];
  const out = mergeHabits(remote, baseline, local);
  assert.equal(out.find(h => h.id === 'h1').status, 'On Hold', 'my change applied');
  assert.equal(out.find(h => h.id === 'h2').name, 'Read 20 pages', "phone's change kept");
});

test('a habit added offline is appended, one added on the phone is kept', () => {
  const baseline = [{ id: 'h1', name: 'Run' }];
  const local = [{ id: 'h1', name: 'Run' }, { id: 'h3', name: 'Stretch' }];
  const remote = [{ id: 'h1', name: 'Run' }, { id: 'h4', name: 'Sauna' }];
  const out = mergeHabits(remote, baseline, local);
  assert.deepEqual(out.map(h => h.id).sort(), ['h1', 'h3', 'h4']);
});

test('a habit deleted offline is deleted, not resurrected by the server copy', () => {
  const baseline = [{ id: 'h1', name: 'Run' }, { id: 'h2', name: 'Read' }];
  const local = [{ id: 'h1', name: 'Run' }];
  const remote = [{ id: 'h1', name: 'Run' }, { id: 'h2', name: 'Read' }];
  assert.deepEqual(mergeHabits(remote, baseline, local).map(h => h.id), ['h1']);
});

test('an empty server array never wipes the local list', () => {
  // habits is a NEVER_EMPTY field: empty means a failed or pre-migration read.
  const local = [{ id: 'h1', name: 'Run' }];
  assert.deepEqual(mergeHabits([], [{ id: 'h1', name: 'Run' }], local), local);
  assert.deepEqual(mergeHabits(null, null, local), local);
});

test('with no baseline the local copy stands', () => {
  const local = [{ id: 'h1', name: 'Run 10k' }];
  const remote = [{ id: 'h1', name: 'Run' }];
  assert.deepEqual(mergeHabits(remote, null, local), local);
});

test('untouched habits keep the server order', () => {
  const baseline = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const local = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const remote = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
  assert.deepEqual(mergeHabits(remote, baseline, local).map(h => h.id), ['c', 'a', 'b']);
});

// ---- cache bookkeeping ------------------------------------------------------

test('applyCellsToLog sets, clears, and prunes empty buckets', () => {
  let log = applyCellsToLog({}, [{ key: 'd1', habitId: 'h1', mark: 'done' }]);
  assert.deepEqual(log, { d1: { h1: 'done' } });
  log = applyCellsToLog(log, [{ key: 'd1', habitId: 'h2', mark: 'skipped' }]);
  assert.deepEqual(log.d1, { h1: 'done', h2: 'skipped' });
  log = applyCellsToLog(log, [{ key: 'd1', habitId: 'h1', mark: null }, { key: 'd1', habitId: 'h2', mark: null }]);
  assert.deepEqual(log, {});
});

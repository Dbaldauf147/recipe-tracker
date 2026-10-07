import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ptoCellsToStamp, ptoMarkFor } from './habitPto.js';

// Wed 19 Aug 2026; PTO Sat 15th → Sat 22nd, so only the 15th–19th can stamp.
const TODAY = new Date(2026, 7, 19);
const RANGE = [{ id: 'r1', start: '2026-08-15', end: '2026-08-22', label: 'Trip' }];
const PTO_DAYS = ['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19'];

const marks = (habits, log = {}, automations = []) =>
  ptoCellsToStamp(habits, log, automations, RANGE, TODAY).map(c => `${c.habitId} ${c.key} ${c.mark}`).sort();

test('ptoMarkFor: Done only when the habit opts in', () => {
  assert.equal(ptoMarkFor({ ptoDone: true }), 'done');
  assert.equal(ptoMarkFor({}), 'skipped');
  assert.equal(ptoMarkFor(null), 'skipped');
});

test('a ptoDone habit logs Done on every PTO day, off-days included', () => {
  // Fri/Sat/Sun only — the real "Weekend habit early completion".
  const h = { id: 'h1', cadence: 'Daily', trackDays: [0, 5, 6], ptoDone: true };
  assert.deepEqual(marks([h]), PTO_DAYS.map(k => `h1 ${k} done`));
});

test('other habits keep Skip on their tracked days only', () => {
  const h = { id: 'h2', cadence: 'Daily', trackDays: [1, 2, 3, 4, 5] };
  assert.deepEqual(marks([h]), ['2026-08-17', '2026-08-18', '2026-08-19'].map(k => `h2 ${k} skipped`));
});

test('a ptoDone habit never overwrites a mark you made', () => {
  const h = { id: 'h1', cadence: 'Daily', ptoDone: true };
  const out = marks([h], { '2026-08-16': { h1: 'skipped' } });
  assert.ok(!out.some(m => m.includes('2026-08-16')));
  assert.equal(out.length, 4);
});

test('a ptoDone habit is stamped even when automatic, but not when parked', () => {
  const auto = { id: 'h1', cadence: 'Daily', status: 'Automatically', ptoDone: true };
  assert.equal(marks([auto]).length, 5);
  const ruled = { id: 'h1', cadence: 'Daily', ptoDone: true };
  assert.equal(marks([ruled], {}, [{ habitId: 'h1', enabled: true }]).length, 5);
  assert.deepEqual(marks([{ id: 'h1', cadence: 'Daily', status: 'On Hold', ptoDone: true }]), []);
});

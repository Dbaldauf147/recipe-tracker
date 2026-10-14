import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitCalendar, calendarCounts } from './habitCalendar.js';

const today = new Date(2026, 9, 14); // Wed 14 Oct 2026
const cells = ms => ms.flatMap(m => m.weeks.flat()).filter(Boolean);

test('covers the months the last 60 days touch, Sunday-first', () => {
  const ms = habitCalendar({ id: 'h', cadence: 'Daily' }, {}, today);
  assert.deepEqual(ms.map(m => m.label), ['Aug 2026', 'Sep 2026', 'Oct 2026']);
  const inWin = cells(ms).filter(c => c.inWindow);
  assert.equal(inWin.length, 60);
  assert.equal(inWin[0].key, '2026-08-16');
  assert.equal(inWin[59].key, '2026-10-14');
  assert.equal(inWin[59].isToday, true);
  assert.deepEqual(ms[2].weeks[0].slice(0, 4), [null, null, null, null]); // 1 Oct is a Thursday
  assert.equal(ms[2].weeks[0][4]?.day, 1);
});

test('daily marks land on their day; outside the window is ignored', () => {
  const log = { '2026-10-13': { h: 'done' }, '2026-10-12': { h: 'missed' }, '2026-08-01': { h: 'done' } };
  const ms = habitCalendar({ id: 'h', cadence: 'Daily' }, log, today);
  const byKey = Object.fromEntries(cells(ms).map(c => [c.key, c]));
  assert.equal(byKey['2026-10-13'].mark, 'done');
  assert.equal(byKey['2026-10-12'].mark, 'missed');
  assert.equal(byKey['2026-08-01'].mark, null);
  assert.deepEqual(calendarCounts(ms), { done: 1, missed: 1 });
});

test('a weekly mark colours every day of its (Sunday-first) week', () => {
  const ms = habitCalendar({ id: 'h', cadence: 'Weekly' }, { '2026-W41': { h: 'done' } }, today);
  assert.deepEqual(cells(ms).filter(c => c.mark === 'done').map(c => c.key),
    ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
});

test('off-weekdays of a Daily habit are untracked', () => {
  const ms = habitCalendar({ id: 'h', cadence: 'Daily', trackDays: [1, 2, 3, 4, 5] }, {}, today);
  assert.equal(cells(ms).find(c => c.key === '2026-10-10').tracked, false);
  assert.equal(cells(ms).find(c => c.key === '2026-10-14').tracked, true);
});

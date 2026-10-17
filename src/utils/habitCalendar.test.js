import { test } from 'node:test';
import assert from 'node:assert/strict';
import { habitCalendar, calendarCounts } from './habitCalendar.js';

const today = new Date(2026, 9, 14); // Wed 14 Oct 2026
const cells = ms => ms.flatMap(m => m.weeks.flat()).filter(Boolean);

test('covers the months the last 60 days touch, newest first, Sunday-first rows', () => {
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Daily' }, {}, today);
  assert.deepEqual(ms.map(m => m.label), ['Oct 2026', 'Sep 2026', 'Aug 2026']);
  const inWin = cells(ms).filter(c => c.inWindow).sort((a, b) => a.key.localeCompare(b.key));
  assert.equal(inWin.length, 60);
  assert.equal(inWin[0].key, '2026-08-16');
  assert.equal(inWin[59].key, '2026-10-14');
  assert.equal(inWin[59].isToday, true);
  // Top row is today's week (Sun 11 – Sat 17 Oct); weeks after it are dropped.
  assert.equal(ms[0].weeks[0][0]?.key, '2026-10-11');
  assert.equal(ms[0].weeks.length, 3);
  // 1 Oct 2026 is a Thursday → four blanks before it, now the month's last row.
  const oct1 = ms[0].weeks[ms[0].weeks.length - 1];
  assert.deepEqual(oct1.slice(0, 4), [null, null, null, null]);
  assert.equal(oct1[4]?.day, 1);
});

test('drops rows wholly before the window', () => {
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Daily' }, {}, today);
  const aug = ms[2];
  // Window starts Sun 16 Aug, so Aug keeps only 16–22, 23–29, 30–31.
  assert.equal(aug.weeks.length, 3);
  assert.equal(aug.weeks[aug.weeks.length - 1][0]?.key, '2026-08-16');
  for (const w of aug.weeks) assert.ok(w.some(c => c?.inWindow));
});

test('daily marks land on their day; with few logs it reaches back to the oldest', () => {
  const log = { '2026-10-13': { h: 'done' }, '2026-10-12': { h: 'missed' }, '2026-08-01': { h: 'done' }, '2025-08-01': { h: 'done' } };
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Daily' }, log, today);
  const byKey = Object.fromEntries(cells(ms).map(c => [c.key, c]));
  assert.equal(byKey['2026-10-13'].mark, 'done');
  assert.equal(byKey['2026-10-12'].mark, 'missed');
  // Only 4 logged days, so the window stretches back to 1 Aug 2026 —
  // but not past the one-year lookback.
  assert.equal(byKey['2026-08-01'].mark, 'done');
  assert.equal(byKey['2025-08-01'], undefined);
  assert.deepEqual(calendarCounts(ms), { done: 2, missed: 1 });
});

test('a weekly mark colours every day of its week', () => {
  const log = { '2026-W41': { h: 'done' } }; // the app's weeks run Sun 4 – Sat 10 Oct
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Weekly' }, log, today);
  const marked = cells(ms).filter(c => c.mark === 'done').map(c => c.key);
  assert.deepEqual(marked, ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']);
});

test('off-weekdays of a Daily habit are untracked', () => {
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Daily', trackDays: [1, 2, 3, 4, 5] }, {}, today);
  const sat = cells(ms).find(c => c.key === '2026-10-10');
  assert.equal(sat.tracked, false);
  assert.equal(cells(ms).find(c => c.key === '2026-10-14').tracked, true);
});

test('reaches back past skipped and blank days until 60 days are logged', () => {
  // 30 done in the last 30 days, a 40-day gap of skips, then 30 more done.
  const log = {};
  for (let i = 0; i < 100; i++) {
    const d = new Date(2026, 9, 14 - i);
    const k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    log[k] = { h: i < 30 || i >= 70 ? 'done' : 'skipped' };
  }
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Daily' }, log, today);
  const inWin = cells(ms).filter(c => c.inWindow);
  assert.equal(inWin.length, 100);
  assert.equal(calendarCounts(ms).done, 60);
  assert.equal(ms[ms.length - 1].label, 'Jul 2026');
});

test('a bad habit keeps the plain 60 days', () => {
  const ms = habitCalendar({ id: 'h', name: 'x', cadence: 'Daily', habitType: 'bad' }, {}, today);
  assert.equal(cells(ms).filter(c => c.inWindow).length, 60);
});

test('flags the day the habit qualified for Automatically', () => {
  const log = {};
  for (let i = 1; i <= 70; i++) {
    const d = new Date(2026, 9, 14 - i);
    log[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = { h: 'done' };
  }
  const ms = habitCalendar({ id: 'h', cadence: 'Daily' }, log, today);
  // 70 straight days from 5 Aug: the 60th one, 3 Oct, is when it first had 60 logged.
  assert.deepEqual(cells(ms).filter(c => c.qualified).map(c => c.key), ['2026-10-03']);
});

// The habit popup's "Last 60 logged days" calendar: month grids with each day
// carrying the habit's mark. Pure, so node --test can load it.
//
// The window reaches back until it holds CALENDAR_DAYS days marked Did it, ★ or
// No — skipped and unlogged days are passed over (never less than the last
// CALENDAR_DAYS calendar days, never more than CALENDAR_LOOKBACK_DAYS). A bad
// habit's clean days are blank by design, so it keeps the plain 60 days.
//
// A day's mark is read from the habit's PERIOD key for that date (habitPeriodKey),
// so a Weekly habit lights every day of a week it logged and a Monthly one every
// day of the month — the same mark the grid shows for that period.
//
// Mirrored in PrepDay src/utils/habitCalendar.ts — change both together.

import { dayKey, habitPeriodKey, tracksDate, isBadHabit } from './habitOutstanding.js';
import { autoPromoteQualifiedDays } from './habitAutoPromote.js';

export const CALENDAR_DAYS = 60;
export const CALENDAR_LOOKBACK_DAYS = 365;

const LOGGED = new Set(['done', 'exceeded', 'missed']);

/** First day of the window: far enough back to hold `days` logged days. */
export function calendarStart(h, habitLog, today = new Date(), days = CALENDAR_DAYS) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  let start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
  if (isBadHabit(h)) return start;
  let found = 0;
  for (let i = 0; i < CALENDAR_LOOKBACK_DAYS && found < days; i++) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    if (LOGGED.has(habitLog?.[habitPeriodKey(h, d)]?.[h.id] ?? '')) {
      found++;
      if (d < start) start = d;
    }
  }
  return start;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Months the window touches, newest first, each as Sunday-first weeks of cells
 * (null pads), newest week first; weeks with no day in the window are dropped.
 * Cell: { key, day, mark, inWindow, tracked, isToday, qualified } — `qualified`
 * is the day the habit crossed the Automatically bar (utils/habitAutoPromote).
 */
export function habitCalendar(h, habitLog, today = new Date(), days = CALENDAR_DAYS) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = calendarStart(h, habitLog, end, days);
  const todayKey = dayKey(end);
  const qualifiedOn = isBadHabit(h) ? new Set() : autoPromoteQualifiedDays(h, habitLog, start, end);
  const months = [];
  for (let y = start.getFullYear(), m = start.getMonth();
    y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth());
    m === 11 ? (y++, m = 0) : m++) {
    const first = new Date(y, m, 1);
    const count = new Date(y, m + 1, 0).getDate();
    const cells = Array(first.getDay()).fill(null);
    for (let d = 1; d <= count; d++) {
      const date = new Date(y, m, d);
      const inWindow = date >= start && date <= end;
      const key = dayKey(date);
      cells.push({
        key, day: d, inWindow,
        mark: inWindow ? (habitLog?.[habitPeriodKey(h, date)]?.[h.id] ?? null) : null,
        tracked: tracksDate(h, date),
        isToday: key === todayKey,
        qualified: inWindow && qualifiedOn.has(key),
      });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) {
      const week = cells.slice(i, i + 7);
      // Rows wholly before the window or after today are just empty boxes.
      if (week.some(c => c?.inWindow)) weeks.push(week);
    }
    months.push({ year: y, month: m, label: `${MONTHS[m]} ${y}`, weeks: weeks.reverse() });
  }
  // Newest at the top: this month first, and within a month the latest week first.
  return months.reverse();
}

/** Mark counts across the window, for the summary line. */
export function calendarCounts(months) {
  const out = {};
  for (const mo of months) for (const w of mo.weeks) for (const c of w) {
    if (c?.inWindow && c.mark) out[c.mark] = (out[c.mark] || 0) + 1;
  }
  return out;
}

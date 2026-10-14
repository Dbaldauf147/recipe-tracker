// The habit popup's "Last 60 days" calendar: month grids with each day carrying
// the habit's mark. Pure, so node --test can load it.
//
// A day's mark is read from the habit's PERIOD key for that date (habitPeriodKey),
// so a Weekly habit lights every day of a week it logged and a Monthly one every
// day of the month — the same mark the grid shows for that period.
//
// Mirrored in PrepDay src/utils/habitCalendar.ts — change both together.

import { dayKey, habitPeriodKey, tracksDate } from './habitOutstanding.js';

export const CALENDAR_DAYS = 60;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Months the window touches, each as Sunday-first weeks of cells (null pads).
 * Cell: { key, day, mark, inWindow, tracked, isToday }.
 */
export function habitCalendar(h, habitLog, today = new Date(), days = CALENDAR_DAYS) {
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
  const todayKey = dayKey(end);
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
      });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
    months.push({ year: y, month: m, label: `${MONTHS[m]} ${y}`, weeks });
  }
  return months;
}

/** Mark counts across the window, for the legend. */
export function calendarCounts(months) {
  const out = {};
  for (const mo of months) for (const w of mo.weeks) for (const c of w) {
    if (c?.inWindow && c.mark) out[c.mark] = (out[c.mark] || 0) + 1;
  }
  return out;
}

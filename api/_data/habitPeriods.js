// Habit period keys, shared by the server crons.
//
// These mirror HabitsPage.jsx (`periodKey` / `weekKey`) and MUST agree with it
// exactly — a mismatch means the server looks in a different habitLog bucket
// from the one the UI writes, so a logged habit reads as unlogged (and an
// automation refills a cell you already filled).
//
// Extracted here because the rule had been copied into each cron: the weekly
// key is Sunday-anchored, which is easy to reimplement subtly wrong.

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function isoWeekKeyFromYMD(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(week)}`;
}

// Sunday-anchored WEEK KEY — mirrors HabitsPage.weekKey. Keeps the "YYYY-Www"
// format but groups a Sunday→Saturday week into one key (ISO week of the day
// AFTER), so a Sunday entry counts for the week it STARTS. Aligns weekly habits
// with the app's Sun–Sat weeks (Week Plan).
export function sundayWeekKeyFromYMD(y, m, d) {
  const nx = new Date(Date.UTC(y, m - 1, d + 1)); // day after (handles rollover)
  return isoWeekKeyFromYMD(nx.getUTCFullYear(), nx.getUTCMonth() + 1, nx.getUTCDate());
}

/** Sunday-week key for a 'YYYY-MM-DD' date string. */
export function weekKeyOfDate(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  return sundayWeekKeyFromYMD(y, m, d);
}

/** The habitLog bucket key for a habit's cadence on a given Eastern y/m/d. */
export function periodKeyFor(cadence, { y, m, d, dateKey }) {
  switch ((cadence || '').trim().toLowerCase()) {
    case 'weekly': return sundayWeekKeyFromYMD(y, m, d);
    case 'monthly': return `${y}-${pad2(m)}`;
    case 'annually': return String(y);
    default: return dateKey; // daily
  }
}

// Day names as HabitsPage stores them in a habit's `weekDays`, indexed by
// JS getDay() (0 = Sunday).
export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

// Statuses that mean "not yours to log" — parked, finished, or tracked for you.
// Mirrors the exclusions in habitOutstanding.js / HabitsPage's outstanding count.
const SKIP_STATUSES = new Set([
  'on hold', 'abandoned', 'automatically', 'not started', 'havent started', "haven't started",
]);

export function isLoggableHabit(h) {
  return !SKIP_STATUSES.has(String(h?.status || '').trim().toLowerCase());
}

/**
 * Weekly habits pinned to specific weekdays that fall on `dow` today.
 *
 * ONLY habits with an explicit `weekDays` are returned: pinning a day is how a
 * habit opts in to being reminded about, so an unpinned weekly habit stays
 * silent rather than firing on an arbitrary day.
 */
export function habitsPinnedToday(habits, dow) {
  const todayName = WEEKDAY_NAMES[dow];
  return (Array.isArray(habits) ? habits : []).filter(h => (
    String(h?.cadence || '').trim().toLowerCase() === 'weekly'
    && Array.isArray(h?.weekDays)
    && h.weekDays.length > 0
    && h.weekDays.some(d => String(d).trim().toLowerCase() === todayName)
    && isLoggableHabit(h)
    && String(h?.name || '').trim()
  ));
}

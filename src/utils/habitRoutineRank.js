// The order routines are listed in, wherever habits are grouped by routine:
// the Habits page's tables and Current tab, and the weekly email's Habits
// section. One rule, so the email can't list them differently from the page.
//
// Pure: no React, no DOM — lib/weeklySummary.js imports it on the server.

// The built-in blocks of a day, in the order the day runs.
export const DAILY_ROUTINES = ['Morning', 'Lunch', 'Afternoon', 'After Work', 'Bedtime'];

export function routineType(routine) {
  const r = (routine || '').trim();
  if (DAILY_ROUTINES.includes(r)) return 'daily';
  if (/^sunday/i.test(r)) return 'weekly';
  if (/^monthly/i.test(r)) return 'monthly';
  if (!r || r === '-') return 'unsorted';
  return 'other';
}

// Default sort: routine type (daily → weekly → monthly → other → unsorted),
// then daily block order / trailing routine number.
export function routineRank(routine) {
  const r = (routine || '').trim();
  const typeOrder = { daily: 0, weekly: 1, monthly: 2, other: 3, unsorted: 4 }[routineType(r)];
  const dailyIdx = DAILY_ROUTINES.indexOf(r);
  const numMatch = r.match(/(\d+)\s*$/);
  return { typeOrder, dailyIdx: dailyIdx < 0 ? 50 : dailyIdx, num: numMatch ? parseInt(numMatch[1], 10) : 9999 };
}

/**
 * Habits split by routine, routines in the canonical order and the ones with
 * no routine last: [[routine, habits], …]. Habits keep the order they came in.
 * `routineOf` reads the routine off one item (default: its `routine` field).
 */
export function groupByRoutine(habits, routineOf = h => h?.routine) {
  const map = new Map();
  for (const h of habits || []) {
    const key = String(routineOf(h) || '').trim();
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(h);
  }
  return [...map.entries()].sort((a, b) => {
    if (!a[0] !== !b[0]) return a[0] ? -1 : 1;   // "No routine" last
    const ra = routineRank(a[0]), rb = routineRank(b[0]);
    return ra.typeOrder - rb.typeOrder || ra.dailyIdx - rb.dailyIdx || ra.num - rb.num || a[0].localeCompare(b[0]);
  });
}

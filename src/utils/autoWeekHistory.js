/**
 * Meal History entries for finished weeks, built from what was planned.
 *
 * Meal History (`planHistory`) used to be written only by "Reset Shopping
 * List" (and the This Week "Save" button), so a week you planned on the Week
 * Plan but never reset left no trace — and the Week Plan's day-by-day meals
 * were never read at all. They live in the daily meal log: the Prepare table
 * writes each placed meal into dailyLog[date].entries with its recipeId.
 *
 * For each finished Sun–Sat week (most recent `weeksBack`), this makes one
 * entry of the recipes in that week's log days, unless the week already has an
 * entry (any entry dated inside it — a reset that week counts) or was
 * processed before (`doneWeeks`, so deleting an auto entry keeps it deleted).
 * Weeks with no recipes are left unprocessed, so they fill in if meals arrive.
 *
 * Pure: no Firebase, no localStorage — tested under node --test.
 */
import { activeEntries } from './dailyTotals.js';

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function parseKey(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}

/** The Sun–Sat days ('YYYY-MM-DD') of the week starting on Sunday `startKey`. */
export function weekDays(startKey) {
  const start = parseKey(startKey);
  if (!start) return [];
  return Array.from({ length: 7 }, (_, i) => keyOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)));
}

/** Sunday-start keys of the `weeksBack` most recent weeks that ENDED before `todayKey`, newest first. */
export function finishedWeekStarts(todayKey, weeksBack = 12) {
  const today = parseKey(todayKey);
  if (!today) return [];
  // This week's Sunday; the week before it is the latest finished one.
  const thisSunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  return Array.from({ length: weeksBack }, (_, i) =>
    keyOf(new Date(thisSunday.getFullYear(), thisSunday.getMonth(), thisSunday.getDate() - 7 * (i + 1))));
}

/** Distinct recipe ids eaten or planned in those log days, in day/slot order. */
export function recipesInDays(dailyLog, days) {
  const ids = [];
  for (const day of days) {
    for (const e of activeEntries(dailyLog?.[day])) {
      const id = e?.recipeId;
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * The entries to add. Each is
 *   { date: weekStart, weekStart, recipeIds, timestamp, source: 'week-plan' }
 * with a timestamp fixed by the week (its Saturday, end of day) so it sorts
 * with the week it describes and is the same on every device.
 */
export function autoWeekEntries({ history = [], doneWeeks = [], dailyLog = {}, todayKey, weeksBack = 12 }) {
  const entries = Array.isArray(history) ? history : [];
  const done = new Set(Array.isArray(doneWeeks) ? doneWeeks : []);
  const out = [];
  for (const start of finishedWeekStarts(todayKey, weeksBack)) {
    if (done.has(start)) continue;
    const days = weekDays(start);
    const end = days[6];
    const covered = entries.some(e => {
      const d = String(e?.date || '');
      return e?.weekStart === start || (d >= start && d <= end);
    });
    if (covered) continue;
    const recipeIds = recipesInDays(dailyLog, days);
    if (recipeIds.length === 0) continue;
    out.push({ date: start, weekStart: start, recipeIds, timestamp: `${end}T23:59:59.000Z`, source: 'week-plan' });
  }
  return out.reverse(); // oldest first, as the history array grows
}

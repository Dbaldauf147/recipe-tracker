// "% of meals tracked" — the number behind the Week Plan's 🍽️ Tracked tile.
//
// Extracted from WeekPlanPage so the habit-automation engine can ask the SAME
// question the tile answers. The tile and the automation disagreeing would be
// the worst outcome: the page would show the goal met while the habit sat
// unmarked, with nothing on screen to explain it.
//
// A "tracked" slot is one that has been ACCOUNTED FOR, not one that was eaten:
// logged, marked skipped, or marked as eating out all count. The point of the
// metric is completeness of the record, not adherence to a diet.

export const MAIN_MEALS = ['breakfast', 'lunch', 'dinner'];

/** Default when the user has never set a target. */
export const DEFAULT_MEALS_TRACKED_PCT = 50;

/**
 * Main-meal slots accounted for on ONE day, plus meals eaten out that day.
 * @param {object|null|undefined} day a dailyLog day entry
 * @returns {{tracked: number, ateOut: number}}
 */
export function mealStatsForDay(day) {
  const entries = Array.isArray(day?.entries) ? day.entries : [];
  const eatOutMarks = Array.isArray(day?.eatingOutMeals) ? day.eatingOutMeals : [];
  let ateOut = 0;
  // Ate out = logged eating-out entries + planned "eating out" grid marks.
  for (const e of entries) if (e?.eatingOut) ateOut += 1;
  for (const s of eatOutMarks) if (MAIN_MEALS.includes(s)) ateOut += 1;
  // A day marked "not tracked" counts as fully accounted for — you decided
  // about it, which is what the metric measures.
  if (day?.daySkipped) return { tracked: MAIN_MEALS.length, ateOut };
  const skipped = Array.isArray(day?.skippedMeals) ? day.skippedMeals : [];
  const accounted = new Set();
  for (const e of entries) if (MAIN_MEALS.includes(e.mealSlot)) accounted.add(e.mealSlot);
  for (const s of skipped) if (MAIN_MEALS.includes(s)) accounted.add(s);
  // Deciding a meal is "eating out" accounts for that slot (like a skip), so it
  // doesn't count against the tracked %.
  for (const s of eatOutMarks) if (MAIN_MEALS.includes(s)) accounted.add(s);
  return { tracked: accounted.size, ateOut };
}

/**
 * % of the period's main-meal slots tracked, plus meals eaten out.
 * @param {string[]} days 'YYYY-MM-DD' date keys
 * @param {object} dailyLog map of dateKey → day
 * @returns {{pct: number, ateOut: number}}
 */
export function mealStatsForDays(days, dailyLog) {
  let trackedSlots = 0;
  let ateOut = 0;
  for (const date of days) {
    const s = mealStatsForDay((dailyLog || {})[date]);
    trackedSlots += s.tracked;
    ateOut += s.ateOut;
  }
  const totalSlots = days.length * MAIN_MEALS.length;
  return { pct: totalSlots > 0 ? Math.round((trackedSlots / totalSlots) * 100) : 0, ateOut };
}

/**
 * The user's meals-tracked target, clamped to 0-100.
 * Reuses `dailyMealsTrackedPct` — the same goal the "% of Meals Tracked" chart
 * edits — rather than inventing a second target that could disagree with it.
 * @param {object|null|undefined} nutritionGoals
 * @returns {number}
 */
export function mealsTrackedGoalOf(nutritionGoals) {
  const v = nutritionGoals?.dailyMealsTrackedPct;
  if (v == null || isNaN(Number(v))) return DEFAULT_MEALS_TRACKED_PCT;
  return Math.max(0, Math.min(100, Number(v)));
}

/**
 * The seven 'YYYY-MM-DD' keys of the SUNDAY-anchored week containing `dateKey`.
 * Sunday-anchored to match both the Week Plan grid and the Sunday weekly habit
 * period key — an ISO (Monday) week here would put a Sunday's meals in one week
 * and the habit cell they should fill in another.
 * @param {string} dateKey
 * @returns {string[]}
 */
export function sundayWeekDates(dateKey) {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const start = new Date(base);
  start.setUTCDate(base.getUTCDate() - base.getUTCDay()); // getUTCDay() 0 = Sunday
  const out = [];
  for (let i = 0; i < 7; i++) {
    const dt = new Date(start);
    dt.setUTCDate(start.getUTCDate() + i);
    out.push(`${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}

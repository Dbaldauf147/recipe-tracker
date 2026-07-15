// Sauna suggestion for the Week Plan.
//
// Sauna has no plan of its own — it's only logged after the fact from the mobile
// app's per-workout 🧖 toggle. So we suggest it: ride along with the planned
// workout days, aiming for `saunaGoal` sessions a week, and let the user pin or
// veto individual days.
//
// MIRRORED SERVER-SIDE in api/sync-workout-calendar.js (the cron can't import
// from src/ — same porting convention as resolveWorkoutPlan). Change both, or
// the Week Plan grid and the synced Google Calendar will disagree about which
// days get a sauna.

export const DEFAULT_SAUNA_GOAL = 3;
export const MAX_SAUNA_GOAL = 7;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeSaunaGoal(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return DEFAULT_SAUNA_GOAL;
  return Math.min(MAX_SAUNA_GOAL, Math.max(0, n));
}

// Per-day user decisions: { 'YYYY-MM-DD': true (pin) | false (veto) }.
export function normalizeSaunaOverrides(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw)) {
    if (DATE_RE.test(k) && typeof v === 'boolean') out[k] = v;
  }
  return out;
}

// Overrides are only meaningful for days that haven't happened yet, so drop the
// stale ones on write instead of growing the user doc forever.
export function pruneSaunaOverrides(overrides, todayStr) {
  const ov = normalizeSaunaOverrides(overrides);
  const out = {};
  for (const [k, v] of Object.entries(ov)) if (k >= todayStr) out[k] = v;
  return out;
}

// Pick `count` evenly-spread positions within [0, len) — used to scatter rest
// days and saunas. (Same helper WeekPlanPage uses for the rest-day spread.)
export function spreadIndices(len, count) {
  const set = new Set();
  if (count <= 0 || len <= 0) return set;
  if (count >= len) { for (let i = 0; i < len; i++) set.add(i); return set; }
  for (let j = 0; j < count; j++) {
    let idx = Math.min(len - 1, Math.round((j + 0.5) * len / count));
    while (set.has(idx) && idx < len - 1) idx += 1;
    while (set.has(idx) && idx > 0) idx -= 1;
    set.add(idx);
  }
  return set;
}

// Which days of one Sun..Sat week should get a sauna.
//
// `weekDates`   — the week's 7 ISO dates, Sunday first (ordering is what makes
//                 the result deterministic across client and cron).
// `plannedDates`— that week's planned, today-or-later workout days.
// `loggedSaunaDays` — days in the week with a sauna already logged.
//
// Precedence: logged > pinned > goal-driven spread > vetoed. Logged and pinned
// days both count against the goal, so pinning a 4th day when the goal is 3
// doesn't silently drop one of the first three — it just uses up the budget.
export function resolveSaunaDates({
  weekDates = [],
  plannedDates = [],
  loggedSaunaDays = [],
  overrides = {},
  goal = DEFAULT_SAUNA_GOAL,
  todayStr = '',
} = {}) {
  const g = normalizeSaunaGoal(goal);
  const ov = normalizeSaunaOverrides(overrides);
  const logged = new Set(loggedSaunaDays);

  // Pinned days win outright — an explicit choice beats the weekly goal, and it
  // holds even on a day with no workout planned (a standalone sauna).
  const out = new Set(weekDates.filter(d => ov[d] === true && !logged.has(d) && d >= todayStr));

  // Whatever budget the goal has left, spread across the remaining workout days
  // rather than front-loading it.
  const budget = Math.max(0, g - logged.size - out.size);
  const candidates = plannedDates.filter(
    d => !logged.has(d) && !out.has(d) && ov[d] !== false && d >= todayStr
  );
  const picks = spreadIndices(candidates.length, Math.min(budget, candidates.length));
  candidates.forEach((d, i) => { if (picks.has(i)) out.add(d); });
  return out;
}

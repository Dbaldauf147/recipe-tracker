// Per-muscle-group stretch goal.
//
// The goal is an amount of TIME held per muscle group over a rolling window —
// "10 minutes of legs this week" — rather than a session or rep count, because
// that's the unit stretching is actually dosed in.
//
// Time comes from the duration cells the stretch player writes ("40s"), summed
// via each entry's totalSeconds. A stretch logged by hand with a duration in a
// set cell counts too; one logged with plain rep counts contributes nothing,
// which is correct — there's no time in it to count.
//
// MIRRORED from the mobile app's src/utils/stretchGoal.ts — change both.

export const DEFAULT_STRETCH_GOAL_MIN = 10;
export const STRETCH_GOAL_WINDOW_DAYS = 7;
export const MIN_GOAL_MIN = 1;
export const MAX_GOAL_MIN = 120;

export function clampGoalMin(n, fallback = DEFAULT_STRETCH_GOAL_MIN) {
  const v = Math.round(Number(n));
  if (!isFinite(v) || v <= 0) return fallback;
  return Math.min(MAX_GOAL_MIN, Math.max(MIN_GOAL_MIN, v));
}

/** YYYY-MM-DD `days` before `today` (inclusive window start). */
export function windowStartDate(today, days = STRETCH_GOAL_WINDOW_DAYS) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Seconds of stretching per muscle group inside the window.
 *
 * `isStretch(exerciseName)` decides what counts — the caller passes it because
 * only it knows the user's exerciseType tagging. Entries whose exercise isn't a
 * stretch are skipped entirely, so a 3-minute plank in the same session doesn't
 * inflate the Abs stretch total.
 */
export function stretchSecondsByGroup(workouts, isStretch, today = new Date(), windowDays = STRETCH_GOAL_WINDOW_DAYS) {
  const start = windowStartDate(today, windowDays);
  const out = {};
  for (const w of workouts || []) {
    if (!w?.date || w.date < start) continue;
    for (const e of w.entries || []) {
      const name = String(e?.exercise || '').trim();
      if (!name || !isStretch(name)) continue;
      const secs = Number(e?.totalSeconds) || 0;
      if (secs <= 0) continue;
      const group = String(e?.group || '').trim() || 'Other';
      out[group] = (out[group] || 0) + secs;
    }
  }
  return out;
}

/**
 * Progress rows for display. `groups` is the set worth showing — normally every
 * muscle group that HAS a stretch tagged to it, so the list reflects what the
 * user actually stretches rather than every group in the app. Groups with time
 * logged are always included even if they've since lost their tagging, so
 * history doesn't silently vanish from the board.
 */
export function stretchGoalProgress(secondsByGroup, groups, goalMin = DEFAULT_STRETCH_GOAL_MIN) {
  const goalSeconds = clampGoalMin(goalMin) * 60;
  const all = new Set([...(groups || []), ...Object.keys(secondsByGroup || {})]);
  return [...all]
    .map(group => {
      const seconds = (secondsByGroup || {})[group] || 0;
      return {
        group,
        seconds,
        goalSeconds,
        pct: goalSeconds > 0 ? Math.min(1, seconds / goalSeconds) : 0,
        met: seconds >= goalSeconds,
      };
    })
    // Furthest-behind first: the board should lead with what needs attention.
    .sort((a, b) => a.seconds - b.seconds || a.group.localeCompare(b.group));
}

/** "8m", "8m 30s", "45s" — compact enough for a progress row. */
export function formatStretchDuration(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem}s`;
  if (rem === 0) return `${m}m`;
  return `${m}m ${rem}s`;
}

// "Did that set just beat your best?" — the trigger behind the PR celebration.
//
// Fires when BOTH are true:
//   1. every set on the row that has a value is marked green (done), and
//   2. the row's best estimated 1RM beats every previous session of that
//      exercise.
//
// The green requirement is the whole point of the timing: a half-finished row
// is a work in progress, and congratulating someone mid-set — then again on the
// next set — would be noise. Waiting for the row to be complete makes the
// celebration mean "that lift is done, and it was your best".
//
// ⚠️ MIRRORS PrepDay/src/utils/personalRecord.ts. The rule is user-visible on
// both platforms and the same workout data feeds both, so a lift that fires
// fireworks on the phone must fire them on the website too.

import { entryBestE1rmLb } from './exerciseProgress.js';

// Floating-point guard. e1RM is a product of two floats, so re-saving an
// identical row can land a hair above the stored best; without this, "the same
// lift again" would celebrate.
export const PR_EPSILON_LB = 0.01;

/**
 * Is every filled set on this row marked done, with at least one filled?
 * An empty set cell is "not attempted", not "not finished" — so a 3-set row in
 * a 4-column grid counts as complete.
 */
export function allSetsGreen(entry) {
  const sets = Array.isArray(entry?.sets) ? entry.sets : [];
  const done = Array.isArray(entry?.setDone) ? entry.setDone : [];
  let filled = 0;
  for (let i = 0; i < sets.length; i++) {
    const v = sets[i];
    if (v === '' || v == null) continue;
    filled += 1;
    if (!done[i]) return false;
  }
  return filled > 0;
}

/**
 * Best estimated 1RM ever recorded for `exerciseName` in `history`.
 * `history` must EXCLUDE the session being judged — the caller owns that, so
 * this stays pure and testable.
 * @returns {number} lb, or 0 when the exercise has never been logged
 */
export function previousBestE1rmLb(history, exerciseName) {
  const target = String(exerciseName || '').trim().toLowerCase();
  if (!target) return 0;
  let best = 0;
  for (const w of (history || [])) {
    for (const e of (w?.entries || [])) {
      if (String(e?.exercise || '').trim().toLowerCase() !== target) continue;
      const v = entryBestE1rmLb(e);
      if (v > best) best = v;
    }
  }
  return best;
}

/**
 * History STRICTLY BEFORE `dateKey` — what to judge a PR against.
 *
 * Not just "the workouts array": the session being logged is auto-saved into
 * history while you are still in it (and each auto-save mints a new id), so
 * comparing against the raw array would compare the row against a saved copy of
 * ITSELF. The previous best would already equal the current lift, the gain would
 * be zero, and a genuine record would silently never fire.
 *
 * Same-day sessions are excluded wholesale rather than by id, which also gives
 * the rule a statable meaning: a PR beats every day BEFORE today.
 *
 * @param {object[]} workouts
 * @param {string} dateKey 'YYYY-MM-DD'
 */
export function priorHistory(workouts, dateKey) {
  const d = String(dateKey || '');
  if (!d) return workouts || [];
  return (workouts || []).filter(w => String(w?.date || '') < d);
}

/**
 * Judge one row against the exercise's history.
 *
 * @param {object} entry   the row being edited (sets, setDone, weight, …)
 * @param {object[]} history prior workouts, EXCLUDING this session
 * @returns {{isPr: boolean, e1rmLb: number, previousLb: number, gainLb: number}}
 */
export function detectPersonalRecord(entry, history) {
  const name = String(entry?.exercise || '').trim();
  const e1rmLb = entryBestE1rmLb(entry);
  const previousLb = previousBestE1rmLb(history, name);
  const gainLb = e1rmLb - previousLb;
  const isPr = !!name
    && allSetsGreen(entry)
    && e1rmLb > 0
    // A baseline is required, so the FIRST time an exercise is ever logged is
    // not a "record" — every new exercise would fire on its first row, which
    // reads as a bug rather than an achievement.
    && previousLb > 0
    && gainLb > PR_EPSILON_LB;
  return { isPr, e1rmLb, previousLb, gainLb };
}

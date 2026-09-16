/**
 * Sizing rules for the localStorage copy of the workout log.
 *
 * A long training history outgrows localStorage: ~3,600 sessions serialize to
 * roughly 6 MB and browsers cap an origin at about 5 MB. The write then throws
 * QuotaExceededError, and a caller that swallows it is left with a mirror
 * FROZEN at whatever last fit — missing exactly the NEWEST sessions, which is
 * the half anyone reading it cares about. "I logged that yesterday and the
 * Week Plan says rest day" is what that looks like.
 *
 * So the mirror degrades instead: the whole log if it fits, else the most
 * recent N, else nothing at all. Losing the oldest rows from a CACHE costs a
 * slower first paint and nothing else — the live Firestore subscription
 * replaces the list moments later, and everything that reads history in depth
 * (charts, trends, the weekly email) reads that rather than this.
 *
 * Storing a short list is safe for the save path too: the delete half of the
 * Firestore diff is baselined on the in-memory _lastSyncedWorkouts, which
 * starts empty on every page load, so a truncated cache produces upserts and
 * never deletes.
 */

export const WORKOUTS_STORAGE_KEY = 'sunday-workout-log';
/** Set when the mirror holds only the newest slice of the log. */
export const WORKOUTS_PARTIAL_KEY = 'sunday-workout-log-partial';

/** Window sizes to try, largest first, when the full log won't fit. */
export const MIRROR_FALLBACK_SIZES = [1000, 500, 250, 100];

/**
 * The candidate payloads to attempt, newest-first and largest-first: the whole
 * log, then each fallback window smaller than it.
 *
 * Pure, so the shrinking rule can be tested without a storage quota to trip.
 */
export function mirrorCandidates(workouts, sizes = MIRROR_FALLBACK_SIZES) {
  const list = Array.isArray(workouts) ? workouts : [];
  const byNewest = [...list].sort(
    (x, y) => String(y?.date || '').localeCompare(String(x?.date || '')),
  );
  const out = [byNewest];
  for (const n of sizes) {
    if (n >= byNewest.length) continue;
    out.push(byNewest.slice(0, n));
  }
  return out;
}

/**
 * Write the mirror, degrading to a recent window when the log is too big for
 * localStorage, and dropping it entirely when even that fails.
 *
 * `WORKOUTS_PARTIAL_KEY` records that the copy is a window, so a reader can
 * tell "no older workouts" from "not cached here".
 */
export function writeWorkoutsMirror(workouts) {
  const candidates = mirrorCandidates(workouts);
  for (let i = 0; i < candidates.length; i++) {
    const json = JSON.stringify(candidates[i]);
    try {
      if (localStorage.getItem(WORKOUTS_STORAGE_KEY) !== json) {
        localStorage.setItem(WORKOUTS_STORAGE_KEY, json);
      }
      if (i === 0) {
        localStorage.removeItem(WORKOUTS_PARTIAL_KEY);
      } else {
        localStorage.setItem(WORKOUTS_PARTIAL_KEY, '1');
        console.warn(`[workouts] localStorage over quota — cached only the ${candidates[i].length} most recent workouts. Firestore holds the full log.`);
      }
      return true;
    } catch { /* over quota — try a smaller window */ }
  }
  // Nothing fit, or storage is disabled. A cache we can't refresh is worse than
  // none: drop it rather than let a page seed from a frozen copy.
  try {
    localStorage.removeItem(WORKOUTS_STORAGE_KEY);
    localStorage.setItem(WORKOUTS_PARTIAL_KEY, '1');
  } catch { /* nothing more to do */ }
  console.warn('[workouts] localStorage over quota — skipped the local cache entirely. Firestore holds the full log.');
  return false;
}

/** True when the mirror is only the newest slice of the log, not all of it. */
export function isWorkoutsMirrorPartial() {
  try {
    return localStorage.getItem(WORKOUTS_PARTIAL_KEY) === '1';
  } catch {
    return false;
  }
}

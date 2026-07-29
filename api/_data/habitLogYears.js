// Server-side (firebase-admin) reader/writer for the per-year habitLog.
//
// The browser copy of this lives in src/utils/habitLogYears.js and owns the
// migration; this half deliberately does NOT migrate or delete the legacy
// user-doc field. A cron and a browser both racing the same delete buys nothing
// — the crons only need to READ the log correctly wherever it currently is, and
// to WRITE without recreating the field that blew the index limit.
//
// Layout: users/{uid}/habitLog/{YYYY} = { marks: '<json>', v: 1, updatedAt }
// Keep the key/merge semantics identical to the browser file.

// The key parsing / merge rules are shared VERBATIM with the browser — one
// implementation, imported by both, so a period key can never be filed into a
// different year on the server than it is in the app.
import {
  yearOfPeriodKey, splitByYear, yearsForKeys,
  parseYearDoc, countMarks, mergeLogs,
} from '../../src/utils/habitLogKeys.js';

export {
  yearOfPeriodKey, splitByYear, yearsForKeys,
  parseYearDoc, countMarks, mergeLogs,
};

export const HABIT_LOG_VERSION = 1;
const COLL = 'habitLog';

/**
 * The user's whole habitLog, from wherever it currently lives.
 *
 * `userData` is the already-fetched user document (both crons have one in hand,
 * so this avoids a second read). During the transition a user may have marks in
 * both places — year docs are newer, so they win per cell.
 */
export async function loadHabitLogAdmin(db, uid, userData) {
  const byYear = {};
  try {
    const snaps = await db.collection(`users/${uid}/${COLL}`).get();
    snaps.forEach(s => { byYear[s.id] = parseYearDoc(s.data()); });
  } catch { /* no subcollection → legacy only */ }
  let years = {};
  for (const y of Object.keys(byYear).sort()) years = { ...years, ...byYear[y] };

  const legacy = userData?.habitLog;
  if (legacy && typeof legacy === 'object' && countMarks(legacy) > 0) {
    return mergeLogs(legacy, years);
  }
  return years;
}

/**
 * Write the given years of `log` back to their year documents.
 *
 * Only the touched years are rewritten. Passing no years rewrites every year
 * present in the log.
 */
export async function saveHabitLogYearsAdmin(db, uid, log, years) {
  const byYear = splitByYear(log);
  const targets = years && years.length ? years : Object.keys(byYear);
  const updatedAt = new Date().toISOString();
  await Promise.all(targets.map(year => (
    db.doc(`users/${uid}/${COLL}/${year}`).set({
      marks: JSON.stringify(byYear[year] || {}),
      v: HABIT_LOG_VERSION,
      updatedAt,
    })
  )));
}

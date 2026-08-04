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
  parseYearDoc, countMarks, mergeLogs, cellsByYear, applyCells, diffCells,
} from '../../src/utils/habitLogKeys.js';

export {
  yearOfPeriodKey, splitByYear, yearsForKeys,
  parseYearDoc, countMarks, mergeLogs, cellsByYear, applyCells, diffCells,
};

export const HABIT_LOG_VERSION = 1;
// For both maps the legacy user-doc FIELD name and the subcollection name are
// the same string, so one value identifies both locations.
export const HABIT_LOG = 'habitLog';
export const HABIT_LOG_AUTO = 'habitLogAuto';

/**
 * One of the user's mark maps, from wherever it currently lives.
 *
 * `userData` is the already-fetched user document (both crons have one in hand,
 * so this avoids a second read). During the transition a user may have marks in
 * both places — year docs are newer, so they win per cell.
 */
export async function loadMarksAdmin(db, uid, userData, field = HABIT_LOG) {
  const byYear = {};
  try {
    const snaps = await db.collection(`users/${uid}/${field}`).get();
    snaps.forEach(s => { byYear[s.id] = parseYearDoc(s.data()); });
  } catch { /* no subcollection → legacy only */ }
  let years = {};
  for (const y of Object.keys(byYear).sort()) years = { ...years, ...byYear[y] };

  const legacy = userData?.[field];
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
export async function saveMarkYearsAdmin(db, uid, log, years, field = HABIT_LOG) {
  const byYear = splitByYear(log);
  const targets = years && years.length ? years : Object.keys(byYear);
  const updatedAt = new Date().toISOString();
  await Promise.all(targets.map(year => (
    db.doc(`users/${uid}/${field}/${year}`).set({
      marks: JSON.stringify(byYear[year] || {}),
      v: HABIT_LOG_VERSION,
      updatedAt,
    })
  )));
}

/**
 * Write INDIVIDUAL CELLS, merged into the year document inside a transaction.
 *
 * The cron reads a user's whole log, spends time evaluating rules against it,
 * and only then writes. Handing back its whole copy of the year would undo any
 * mark made in the app during that gap — and symmetrically, the app used to
 * undo the cron's. Both sides now write only what they changed.
 */
export async function saveMarkCellsAdmin(db, uid, cells, field = HABIT_LOG) {
  const byYear = cellsByYear(cells);
  await Promise.all(Object.keys(byYear).map(year => (
    db.runTransaction(async (tx) => {
      const ref = db.doc(`users/${uid}/${field}/${year}`);
      const snap = await tx.get(ref);
      const prev = snap.exists ? parseYearDoc(snap.data()) : {};
      tx.set(ref, {
        marks: JSON.stringify(applyCells(prev, byYear[year])),
        v: HABIT_LOG_VERSION,
        updatedAt: new Date().toISOString(),
      });
    })
  )));
}

// Named wrappers, so call sites read as what they are.
export const loadHabitLogAdmin = (db, uid, userData) => loadMarksAdmin(db, uid, userData, HABIT_LOG);
export const saveHabitLogYearsAdmin = (db, uid, log, years) => saveMarkYearsAdmin(db, uid, log, years, HABIT_LOG);
export const loadHabitLogAutoAdmin = (db, uid, userData) => loadMarksAdmin(db, uid, userData, HABIT_LOG_AUTO);
export const saveHabitLogAutoYearsAdmin = (db, uid, log, years) => saveMarkYearsAdmin(db, uid, log, years, HABIT_LOG_AUTO);
export const saveHabitLogCellsAdmin = (db, uid, cells) => saveMarkCellsAdmin(db, uid, cells, HABIT_LOG);
export const saveHabitLogAutoCellsAdmin = (db, uid, cells) => saveMarkCellsAdmin(db, uid, cells, HABIT_LOG_AUTO);

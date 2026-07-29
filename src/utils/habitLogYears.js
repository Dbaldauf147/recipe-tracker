// habitLog storage: one Firestore document per calendar year.
//
// WHY: habitLog used to be a field on the user document. Firestore indexes
// every value in a document twice (ascending + descending), so a map holding
// ~25,000 marks produced ~50,000 index entries and blew the hard limit of
// 40,000 per document. Past that limit Firestore rejects EVERY write to the
// document — which took down adding an exercise, saving habits, everything
// else sharing the user doc.
//
// Two decisions come out of that:
//   1. Per YEAR, not one big doc — keeps each document small and means a mark
//      only rewrites the year it belongs to (~60 KB) instead of the whole log.
//   2. The marks are stored as a JSON STRING, not a map. A map would put us
//      back on the same cliff: 50 habits x 365 days is 36,500 index entries,
//      one habit shy of the wall. A string is ONE indexed value per document,
//      so no amount of history can hit the limit again.
//
// Nothing queries inside habitLog — both apps load the whole log into memory —
// so giving up queryability inside the field costs nothing.
//
// Layout: users/{uid}/habitLog/{YYYY} = { marks: '<json>', v: 1, updatedAt }

import { doc, getDoc, getDocs, setDoc, collection, deleteField, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export const HABIT_LOG_VERSION = 1;
const COLL = 'habitLog';

/**
 * Year a period key belongs to. Every cadence's key starts with the 4-digit
 * year: daily '2026-07-28', weekly '2026-W31', monthly '2026-07', annual '2026'.
 * Returns null for anything else so junk keys can be dropped rather than
 * silently filed under the wrong year.
 */
export function yearOfPeriodKey(key) {
  const m = String(key || '').match(/^(\d{4})(?:$|[-W])/);
  return m ? m[1] : null;
}

/** Split a whole habitLog into { year: { periodKey: {habitId: mark} } }. */
export function splitByYear(log) {
  const out = {};
  for (const key of Object.keys(log || {})) {
    const year = yearOfPeriodKey(key);
    if (!year) continue;
    const row = log[key];
    if (!row || typeof row !== 'object' || Object.keys(row).length === 0) continue;
    (out[year] || (out[year] = {}))[key] = row;
  }
  return out;
}

/** Which years a set of period keys touches (what a write needs to rewrite). */
export function yearsForKeys(keys) {
  const years = new Set();
  for (const k of keys || []) {
    const y = yearOfPeriodKey(k);
    if (y) years.add(y);
  }
  return [...years];
}

/** Merge year documents back into one habitLog. */
export function mergeYearDocs(docsByYear) {
  const log = {};
  for (const year of Object.keys(docsByYear || {}).sort()) {
    const part = docsByYear[year] || {};
    for (const key of Object.keys(part)) log[key] = part[key];
  }
  return log;
}

/** Parse one year document's stored payload; tolerates the legacy map shape. */
export function parseYearDoc(data) {
  if (!data) return {};
  const raw = data.marks;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  // A map-shaped payload (an older write, or hand-edited in the console).
  return raw && typeof raw === 'object' ? raw : {};
}

/** Count the marks in a habitLog — used for the migration's verification. */
export function countMarks(log) {
  let n = 0;
  for (const key of Object.keys(log || {})) n += Object.keys(log[key] || {}).length;
  return n;
}

// ---- Firestore -------------------------------------------------------------

/** Load and merge every year document. Returns {} when there are none. */
export async function loadHabitLogYears(uid) {
  if (!uid) return {};
  const snaps = await getDocs(collection(db, 'users', uid, COLL));
  const byYear = {};
  snaps.forEach(s => { byYear[s.id] = parseYearDoc(s.data()); });
  return mergeYearDocs(byYear);
}

/**
 * Write just the years the caller touched. `log` is the FULL in-memory log;
 * only `years` get rewritten, so logging today never rewrites 2014.
 */
export async function saveHabitLogYears(uid, log, years) {
  if (!uid) return;
  const byYear = splitByYear(log);
  const targets = years && years.length ? years : Object.keys(byYear);
  await Promise.all(targets.map(year => {
    const part = byYear[year] || {};
    const ref = doc(db, 'users', uid, COLL, year);
    // An emptied year is written as an empty payload rather than deleted, so a
    // later read can't mistake "cleared" for "never migrated".
    return setDoc(ref, {
      marks: JSON.stringify(part),
      v: HABIT_LOG_VERSION,
      updatedAt: new Date().toISOString(),
    });
  }));
}

/** True once at least one year document exists (i.e. this uid is migrated). */
export async function hasMigratedHabitLog(uid) {
  if (!uid) return false;
  const snaps = await getDocs(collection(db, 'users', uid, COLL));
  return !snaps.empty;
}

/**
 * One-time move of the user-doc `habitLog` field into year documents.
 *
 * Deliberately ordered so data is never in flight alone: write every year doc
 * first, read them all back and compare the mark count, and only then clear the
 * user-doc field. A failure at any step leaves the original field untouched.
 *
 * Clearing the field is also what frees the ~50,000 index entries that are
 * currently rejecting every write to the user document.
 */
export async function migrateHabitLogToYearDocs(uid, { dryRun = false } = {}) {
  if (!uid) throw new Error('migrateHabitLogToYearDocs: no uid');
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  const source = (snap.exists() && snap.data()?.habitLog) || null;
  const sourceCount = countMarks(source);
  if (!source || sourceCount === 0) {
    return { migrated: false, reason: 'no habitLog on the user doc', sourceCount: 0 };
  }

  const byYear = splitByYear(source);
  const years = Object.keys(byYear).sort();
  if (dryRun) return { migrated: false, dryRun: true, sourceCount, years };

  await saveHabitLogYears(uid, source, years);

  // Read back before touching the original.
  const readBack = await loadHabitLogYears(uid);
  const readBackCount = countMarks(readBack);
  if (readBackCount !== sourceCount) {
    throw new Error(
      `habitLog migration verification failed: wrote ${sourceCount} marks, read back ${readBackCount}. `
      + 'The user-doc field was left untouched.',
    );
  }

  await updateDoc(userRef, { habitLog: deleteField() });
  return { migrated: true, sourceCount, readBackCount, years };
}

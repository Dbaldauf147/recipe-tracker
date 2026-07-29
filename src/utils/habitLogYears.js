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
import { writeDataSnapshot, alertGuardBlock } from './firestoreSync';
// The key parsing / merge rules are shared verbatim with the crons — see
// habitLogKeys.js. Re-exported so existing importers of this module are
// unaffected by where they live.
import {
  yearOfPeriodKey, splitByYear, yearsForKeys, mergeYearDocs,
  parseYearDoc, countMarks, mergeLogs,
} from './habitLogKeys';

export {
  yearOfPeriodKey, splitByYear, yearsForKeys, mergeYearDocs,
  parseYearDoc, countMarks, mergeLogs,
};

export const HABIT_LOG_VERSION = 1;
const COLL = 'habitLog';

// ---- Firestore -------------------------------------------------------------

/**
 * Mark count last seen for a year document, keyed `uid:YYYY`.
 *
 * This exists so the shrink guard below costs nothing on the common path. The
 * whole point of moving to year docs was to make logging a habit fast; adding a
 * getDoc round-trip before every tap would hand that back. Holding the last
 * known count lets saveOneYear decide from memory whether a write is ordinary
 * or worth verifying against the server first.
 */
const yearMarkCounts = new Map();
const countKey = (uid, year) => `${uid}:${year}`;

/** Load and merge every year document. Returns {} when there are none. */
export async function loadHabitLogYears(uid) {
  if (!uid) return {};
  const snaps = await getDocs(collection(db, 'users', uid, COLL));
  const byYear = {};
  snaps.forEach(s => {
    const part = parseYearDoc(s.data());
    byYear[s.id] = part;
    yearMarkCounts.set(countKey(uid, s.id), countMarks(part));
  });
  return mergeYearDocs(byYear);
}

/** Read the legacy user-doc `habitLog` field (absent once migrated). */
export async function loadLegacyHabitLogField(uid) {
  if (!uid) return {};
  const snap = await getDoc(doc(db, 'users', uid));
  const raw = snap.exists() ? snap.data()?.habitLog : null;
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Write just the years the caller touched. `log` is the FULL in-memory log;
 * only `years` get rewritten, so logging today never rewrites 2014.
 *
 * Each year is guarded like the user-doc fields are: a write that would empty a
 * year holding marks is blocked outright, and a write that drops more than one
 * mark at once snapshots the old content to dataSnapshots first. habitLog is
 * hand-entered history with no other source of truth, so a silent shrink is
 * unrecoverable.
 */
export async function saveHabitLogYears(uid, log, years) {
  if (!uid) return;
  const byYear = splitByYear(log);
  const targets = years && years.length ? years : Object.keys(byYear);
  await Promise.all(targets.map(year => saveOneYear(uid, year, byYear[year] || {})));
}

async function saveOneYear(uid, year, part) {
  const ref = doc(db, 'users', uid, COLL, year);
  const newCount = countMarks(part);
  const ck = countKey(uid, year);
  const known = yearMarkCounts.get(ck);

  // When to spend a round trip verifying what's on the server before
  // overwriting it. NOT on every shrink: clearing a mark (tapping the active
  // one again) is an ordinary action that shrinks the year by exactly 1, and
  // making that pay for a read — and a snapshot — would both slow down the
  // interaction the year-doc split exists to speed up and bury the real
  // snapshots under routine churn.
  const needsVerify = known === undefined      // no baseline yet this session
    || newCount === 0                          // about to empty a year — always check
    || known - newCount > 1;                   // bulk shrink, not a single un-toggle

  if (needsVerify) {
    let prev = {};
    try {
      const snap = await getDoc(ref);
      if (snap.exists()) prev = parseYearDoc(snap.data());
    } catch { /* unreadable → fall through and write */ }
    const prevCount = countMarks(prev);
    yearMarkCounts.set(ck, prevCount);

    if (prevCount > 0 && newCount === 0) {
      const msg = `[habitLog ${year}] blocked overwrite: would erase ${prevCount} marks with an empty write`;
      console.error(msg);
      alertGuardBlock(`habitLog:${year}`, prevCount);
      throw new Error(msg);
    }
    if (prevCount - newCount > 1) {
      await writeDataSnapshot(uid, 'habitLog', { [year]: prev }, prevCount);
    }
  }

  // An emptied year is written as an empty payload rather than deleted, so a
  // later read can't mistake "cleared" for "never migrated".
  await setDoc(ref, {
    marks: JSON.stringify(part),
    v: HABIT_LOG_VERSION,
    updatedAt: new Date().toISOString(),
  });
  yearMarkCounts.set(ck, newCount);
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
  if (!source || countMarks(source) === 0) {
    return { migrated: false, reason: 'no habitLog on the user doc', sourceCount: 0 };
  }

  // Any year docs already written (by the phone, or by an earlier run that got
  // as far as writing but not as far as clearing the field) are NEWER than the
  // field and must win per cell — otherwise a migration triggered from a second
  // device would roll back marks made since the first one wrote.
  const existing = await loadHabitLogYears(uid);
  const merged = mergeLogs(source, existing);
  const mergedCount = countMarks(merged);

  const byYear = splitByYear(merged);
  const years = Object.keys(byYear).sort();
  if (dryRun) return { migrated: false, dryRun: true, sourceCount: mergedCount, years };

  await saveHabitLogYears(uid, merged, years);

  // Read back before touching the original.
  const readBack = await loadHabitLogYears(uid);
  const readBackCount = countMarks(readBack);
  if (readBackCount !== mergedCount) {
    throw new Error(
      `habitLog migration verification failed: wrote ${mergedCount} marks, read back ${readBackCount}. `
      + 'The user-doc field was left untouched.',
    );
  }

  await updateDoc(userRef, { habitLog: deleteField() });
  return { migrated: true, sourceCount: mergedCount, readBackCount, years };
}

// ---- The read/write facade the app uses ------------------------------------

/**
 * Load the whole habitLog, migrating the user-doc field on the way if it's
 * still there.
 *
 * Migration is self-healing rather than a button someone has to remember,
 * because the state it repairs is actively broken: while the field is on the
 * user document it holds ~50,000 index entries against a 40,000 limit, and
 * Firestore rejects EVERY write to that document until it's gone. Waiting for a
 * manual trigger would mean saving a habit or adding an exercise keeps failing
 * in the meantime.
 *
 * If the migration itself fails (offline, rules) we still return the union of
 * both locations, so a bad network degrades to "reads fine, writes retry later"
 * instead of "history looks empty".
 */
export async function loadHabitLog(uid) {
  if (!uid) return {};
  const years = await loadHabitLogYears(uid);
  const legacy = await loadLegacyHabitLogField(uid);
  if (countMarks(legacy) === 0) return years;

  try {
    await migrateHabitLogToYearDocs(uid);
    return await loadHabitLogYears(uid);
  } catch (err) {
    console.error('[habitLog] migration failed; reading both locations', err);
    return mergeLogs(legacy, years);
  }
}

/**
 * Persist a habitLog change. `log` is the full in-memory log; `touchedKeys` are
 * the period keys that actually changed, so only those years get rewritten.
 * Omitting touchedKeys rewrites every year (used by bulk imports).
 */
export async function saveHabitLog(uid, log, touchedKeys) {
  if (!uid) return;
  if (touchedKeys === undefined) { await saveHabitLogYears(uid, log); return; }
  const years = yearsForKeys(touchedKeys);
  // No resolvable year → nothing to write. Falling through would make
  // saveHabitLogYears treat the empty list as "rewrite every year".
  if (years.length === 0) return;
  await saveHabitLogYears(uid, log, years);
}

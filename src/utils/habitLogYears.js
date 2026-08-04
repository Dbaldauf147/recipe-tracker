// Habit mark storage: one Firestore document per calendar year.
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
// Nothing queries inside these maps — every client loads the whole thing into
// memory — so giving up queryability inside the field costs nothing.
//
// Layout: users/{uid}/{field}/{YYYY} = { marks: '<json>', v: 1, updatedAt }

import { doc, getDoc, getDocs, setDoc, collection, deleteField, updateDoc, runTransaction } from 'firebase/firestore';
import { db } from '../firebase';
import { writeDataSnapshot, alertGuardBlock } from './firestoreSync';
// The key parsing / merge rules are shared verbatim with the crons — see
// habitLogKeys.js. Re-exported so existing importers of this module are
// unaffected by where they live.
import {
  yearOfPeriodKey, splitByYear, yearsForKeys, mergeYearDocs,
  parseYearDoc, countMarks, mergeLogs, cellsByYear, applyCells, diffCells,
} from './habitLogKeys';

export {
  yearOfPeriodKey, splitByYear, yearsForKeys, mergeYearDocs,
  parseYearDoc, countMarks, mergeLogs, cellsByYear, applyCells, diffCells,
};

export const HABIT_LOG_VERSION = 1;

/**
 * The two mark maps that outgrew the user document. For both, the legacy
 * user-doc FIELD name and the subcollection name are the same string, so one
 * value identifies both locations.
 *
 *   habitLog     — the ✓/✕ history. Hand-entered, no other source of truth, so
 *                  emptying a year is always a bug and is blocked outright.
 *   habitLogAuto — which cells the automation engine set. Largely derivable,
 *                  but it also encodes "the user cleared this on purpose, don't
 *                  refill it", so it's still snapshotted before a bulk shrink.
 *                  NOT blocked on empty: claiming every auto cell in a year back
 *                  by hand is a legitimate thing to do.
 */
export const HABIT_LOG = 'habitLog';
export const HABIT_LOG_AUTO = 'habitLogAuto';
const NEVER_EMPTY = new Set([HABIT_LOG]);

// ---- Firestore -------------------------------------------------------------

/**
 * Mark count last seen for a year document, keyed `uid:field:YYYY`.
 *
 * This exists so the shrink guard below costs nothing on the common path. The
 * whole point of moving to year docs was to make logging a habit fast; adding a
 * getDoc round-trip before every tap would hand that back. Holding the last
 * known count lets saveOneYear decide from memory whether a write is ordinary
 * or worth verifying against the server first.
 */
const yearMarkCounts = new Map();
const countKey = (uid, field, year) => `${uid}:${field}:${year}`;

/** Load and merge every year document of `field`. Returns {} when there are none. */
export async function loadMarkYears(uid, field = HABIT_LOG) {
  if (!uid) return {};
  const snaps = await getDocs(collection(db, 'users', uid, field));
  const byYear = {};
  snaps.forEach(s => {
    const part = parseYearDoc(s.data());
    byYear[s.id] = part;
    yearMarkCounts.set(countKey(uid, field, s.id), countMarks(part));
  });
  return mergeYearDocs(byYear);
}

/** Read the legacy user-doc field (absent once migrated). */
export async function loadLegacyMarkField(uid, field = HABIT_LOG) {
  if (!uid) return {};
  const snap = await getDoc(doc(db, 'users', uid));
  const raw = snap.exists() ? snap.data()?.[field] : null;
  return raw && typeof raw === 'object' ? raw : {};
}

/**
 * Write just the years the caller touched. `log` is the FULL in-memory map;
 * only `years` get rewritten, so logging today never rewrites 2014.
 *
 * Each year is guarded the way the user-doc fields were: for habitLog a write
 * that would empty a year holding marks is blocked outright, and for either map
 * a write that drops more than one mark at once snapshots the old content to
 * dataSnapshots first.
 */
export async function saveMarkYears(uid, log, years, field = HABIT_LOG) {
  if (!uid) return;
  const byYear = splitByYear(log);
  const targets = years && years.length ? years : Object.keys(byYear);
  await Promise.all(targets.map(year => saveOneYear(uid, field, year, byYear[year] || {})));
}

async function saveOneYear(uid, field, year, part) {
  const ref = doc(db, 'users', uid, field, year);
  const newCount = countMarks(part);
  const ck = countKey(uid, field, year);
  const known = yearMarkCounts.get(ck);

  // When to spend a round trip verifying what's on the server before
  // overwriting it. NOT on every shrink: clearing a mark (tapping the active one
  // again, or taking a single cell back from the engine) is an ordinary action
  // that shrinks the year by exactly 1, and making that pay for a read — and a
  // snapshot — would both slow down the interaction the year-doc split exists to
  // speed up and bury the real snapshots under routine churn.
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

    if (prevCount > 0 && newCount === 0 && NEVER_EMPTY.has(field)) {
      const msg = `[${field} ${year}] blocked overwrite: would erase ${prevCount} marks with an empty write`;
      console.error(msg);
      alertGuardBlock(`${field}:${year}`, prevCount);
      throw new Error(msg);
    }
    if (prevCount - newCount > 1) {
      await writeDataSnapshot(uid, field, { [year]: prev }, prevCount);
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

/**
 * Persist INDIVIDUAL CELL changes, merging them into whatever the year document
 * currently holds rather than overwriting it with this client's copy.
 *
 * Prefer this over saveMarkYears for anything a person does one mark at a time.
 *
 * WHY it exists: the whole-map write above treats the caller's in-memory log as
 * the truth for an entire year. That is only safe while nothing else writes, and
 * something else does — the hourly automation engine. The Habits page reads the
 * log once on mount and never refreshes it, so an auto-marked workout recorded
 * at 6pm was wiped by the next tap in a tab opened that morning, which rewrote
 * the year from its stale copy. Worse, the engine then saw an empty cell it had
 * a habitLogAuto record for, read that as a deliberate erase, and left the day
 * blank for good. A transaction over just the named cells has no opinion about
 * the rest of the year, so the two writers stop overwriting each other.
 *
 * Whole-map writes remain right for bulk operations — restore, import, the
 * migration — where replacing the year IS the intent.
 */
export async function saveMarkCells(uid, cells, field = HABIT_LOG) {
  if (!uid) return;
  const byYear = cellsByYear(cells);
  await Promise.all(
    Object.keys(byYear).map(year => saveOneYearCells(uid, field, year, byYear[year])),
  );
}

// Transient failures worth another go. The transaction needs the server (there
// is no offline persistence configured), and callers swallow errors to keep a
// tap from throwing, so a blip would otherwise drop the mark silently.
const CELL_WRITE_ATTEMPTS = 3;

async function saveOneYearCells(uid, field, year, cells) {
  const ref = doc(db, 'users', uid, field, year);
  let blockedCount = 0;
  let finalCount = 0;

  for (let attempt = 1; ; attempt++) {
    try {
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        const prev = snap.exists() ? parseYearDoc(snap.data()) : {};
        const next = applyCells(prev, cells);
        const prevCount = countMarks(prev);
        finalCount = countMarks(next);
        // Mirrors the whole-map guard: a year holding marks must never come out
        // empty. Only reachable by naming every cell in the year, which no
        // interaction does — so it stays a backstop, not a routine path.
        if (prevCount > 0 && finalCount === 0 && NEVER_EMPTY.has(field)) {
          blockedCount = prevCount;
          throw new Error(`[${field} ${year}] blocked write: would erase ${prevCount} marks`);
        }
        tx.set(ref, {
          marks: JSON.stringify(next),
          v: HABIT_LOG_VERSION,
          updatedAt: new Date().toISOString(),
        });
      });
      break;
    } catch (err) {
      if (blockedCount) { // a guard trip, not a network problem — don't retry it
        console.error(err.message);
        alertGuardBlock(`${field}:${year}`, blockedCount);
        throw err;
      }
      if (attempt >= CELL_WRITE_ATTEMPTS) throw err;
      await new Promise(r => setTimeout(r, 300 * attempt));
    }
  }

  // Keep the whole-map path's baseline honest: it decides from this count
  // whether a later full write has to verify against the server first.
  yearMarkCounts.set(countKey(uid, field, year), finalCount);
}

/** True once at least one year document exists (i.e. this field is migrated). */
export async function hasMigratedMarks(uid, field = HABIT_LOG) {
  if (!uid) return false;
  const snaps = await getDocs(collection(db, 'users', uid, field));
  return !snaps.empty;
}

/**
 * One-time move of a user-doc mark field into year documents.
 *
 * Deliberately ordered so data is never in flight alone: write every year doc
 * first, read them all back and compare the mark count, and only then clear the
 * user-doc field. A failure at any step leaves the original field untouched.
 *
 * Clearing the field is also what frees the index entries that were rejecting
 * every write to the user document.
 */
export async function migrateMarksToYearDocs(uid, field = HABIT_LOG, { dryRun = false } = {}) {
  if (!uid) throw new Error('migrateMarksToYearDocs: no uid');
  const userRef = doc(db, 'users', uid);
  const snap = await getDoc(userRef);
  const source = (snap.exists() && snap.data()?.[field]) || null;
  if (!source || countMarks(source) === 0) {
    return { migrated: false, reason: `no ${field} on the user doc`, sourceCount: 0 };
  }

  // Any year docs already written (by another device, or by an earlier run that
  // got as far as writing but not as far as clearing the field) are NEWER than
  // the field and must win per cell — otherwise a migration triggered from a
  // second device would roll back marks made since the first one wrote.
  const existing = await loadMarkYears(uid, field);
  const merged = mergeLogs(source, existing);
  const mergedCount = countMarks(merged);

  const byYear = splitByYear(merged);
  const years = Object.keys(byYear).sort();
  if (dryRun) return { migrated: false, dryRun: true, sourceCount: mergedCount, years };

  await saveMarkYears(uid, merged, years, field);

  // Read back before touching the original.
  const readBack = await loadMarkYears(uid, field);
  const readBackCount = countMarks(readBack);
  if (readBackCount !== mergedCount) {
    throw new Error(
      `${field} migration verification failed: wrote ${mergedCount} marks, read back ${readBackCount}. `
      + 'The user-doc field was left untouched.',
    );
  }

  await updateDoc(userRef, { [field]: deleteField() });
  return { migrated: true, sourceCount: mergedCount, readBackCount, years };
}

// ---- The read/write facade the app uses ------------------------------------

/**
 * Load a whole mark map, migrating the user-doc field on the way if it's still
 * there.
 *
 * Migration is self-healing rather than a button someone has to remember,
 * because the state it repairs is actively broken: while a map this size sits on
 * the user document its index entries count against a hard limit of 40,000 per
 * document, and past that limit Firestore rejects EVERY write to the document.
 * Waiting for a manual trigger would mean saving a habit or adding an exercise
 * keeps failing in the meantime.
 *
 * If the migration itself fails (offline, rules) we still return the union of
 * both locations, so a bad network degrades to "reads fine, writes retry later"
 * instead of "history looks empty".
 */
export async function loadMarks(uid, field = HABIT_LOG) {
  if (!uid) return {};
  const years = await loadMarkYears(uid, field);
  const legacy = await loadLegacyMarkField(uid, field);
  if (countMarks(legacy) === 0) return years;

  try {
    await migrateMarksToYearDocs(uid, field);
    return await loadMarkYears(uid, field);
  } catch (err) {
    console.error(`[${field}] migration failed; reading both locations`, err);
    return mergeLogs(legacy, years);
  }
}

/**
 * Persist a mark-map change. `log` is the full in-memory map; `touchedKeys` are
 * the period keys that actually changed, so only those years get rewritten.
 * Omitting touchedKeys rewrites every year (used by bulk imports and restores).
 */
export async function saveMarks(uid, log, touchedKeys, field = HABIT_LOG) {
  if (!uid) return;
  if (touchedKeys === undefined) { await saveMarkYears(uid, log, undefined, field); return; }
  const years = yearsForKeys(touchedKeys);
  // No resolvable year → nothing to write. Falling through would make
  // saveMarkYears treat the empty list as "rewrite every year".
  if (years.length === 0) return;
  await saveMarkYears(uid, log, years, field);
}

// Named wrappers, so call sites read as what they are.
export const loadHabitLog = (uid) => loadMarks(uid, HABIT_LOG);
export const saveHabitLog = (uid, log, touchedKeys) => saveMarks(uid, log, touchedKeys, HABIT_LOG);
export const loadHabitLogAuto = (uid) => loadMarks(uid, HABIT_LOG_AUTO);
export const saveHabitLogAuto = (uid, log, touchedKeys) => saveMarks(uid, log, touchedKeys, HABIT_LOG_AUTO);
// The cell-level writes — what everything that marks a habit should call.
export const saveHabitLogCells = (uid, cells) => saveMarkCells(uid, cells, HABIT_LOG);
export const saveHabitLogAutoCells = (uid, cells) => saveMarkCells(uid, cells, HABIT_LOG_AUTO);

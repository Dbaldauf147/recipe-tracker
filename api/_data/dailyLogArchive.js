// Server-side (firebase-admin) half of the monthly dailyLog archive. The pure
// rules live in src/utils/dailyLogArchive.js, shared verbatim with the browser.
//
// Layout: users/{uid}/data/dailyLog              = { log: { day: {...} } }   (recent days)
//         users/{uid}/dailyLogArchive/{YYYY-MM}  = { log: '<json>', days, entries, v, updatedAt }

import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import {
  ARCHIVE_COLLECTION, ARCHIVE_MONTH_MAX_BYTES, isMonthKey,
  parseArchiveDoc, buildArchiveDoc, flattenArchive, mergeArchiveUnder,
  planArchiveSweep, sameDay,
} from '../../src/utils/dailyLogArchive.js';

/** Every archive month, as { 'YYYY-MM': dayMap }. */
export async function loadArchiveMonthsAdmin(db, uid) {
  const out = {};
  const snaps = await db.collection(`users/${uid}/${ARCHIVE_COLLECTION}`).get();
  snaps.forEach(s => { if (isMonthKey(s.id)) out[s.id] = parseArchiveDoc(s.data()); });
  return out;
}

/**
 * The whole meal log — live doc plus archive. For the readers that reach past
 * the live window (the weekly email). An unreadable archive degrades to the
 * live doc rather than failing the caller.
 */
export async function loadDailyLogAdmin(db, uid) {
  const [liveSnap, archive] = await Promise.all([
    db.doc(`users/${uid}/data/dailyLog`).get(),
    loadArchiveMonthsAdmin(db, uid).catch(() => ({})),
  ]);
  const live = liveSnap.exists ? (liveSnap.data().log || {}) : {};
  return mergeArchiveUnder(flattenArchive(archive), live);
}

/**
 * Move every live day older than the cutoff into its archive month.
 *
 * Order matters for safety: each month is merged into its archive doc first
 * (in a transaction), and only then are its days deleted from the live doc —
 * so a crash between the two leaves a day in both places, never in neither.
 * The delete is a transaction too, and skips any day that changed since it was
 * archived (an edit that landed mid-sweep stays live and is filed next run).
 * Field deletes rather than a whole-doc rewrite, so nothing else on the live
 * doc can be clobbered.
 */
export async function sweepDailyLogArchiveAdmin(db, uid, todayKey) {
  const liveRef = db.doc(`users/${uid}/data/dailyLog`);
  const liveSnap = await liveRef.get();
  const live = liveSnap.exists ? (liveSnap.data().log || {}) : {};
  const plan = planArchiveSweep(live, {}, todayKey);
  const result = { cutoff: plan.cutoff, movedDays: 0, months: [], skipped: [], errors: [] };

  for (const [month, { days }] of Object.entries(plan.months)) {
    const archiveRef = db.doc(`users/${uid}/${ARCHIVE_COLLECTION}/${month}`);
    let archivedLog;
    try {
      archivedLog = await db.runTransaction(async (tx) => {
        const snap = await tx.get(archiveRef);
        const existing = snap.exists ? parseArchiveDoc(snap.data()) : {};
        const merged = planArchiveSweep(
          Object.fromEntries(days.map(d => [d, live[d]])), { [month]: existing }, todayKey,
        ).months[month].log;
        const docData = buildArchiveDoc(month, merged);
        if (docData.log.length > ARCHIVE_MONTH_MAX_BYTES) {
          throw new Error(`archive month ${month} would be ${docData.log.length} bytes`);
        }
        tx.set(archiveRef, docData);
        return merged;
      });
    } catch (err) {
      result.errors.push(`${month}: ${err.message}`);
      continue; // its days stay in the live doc — nothing lost, retried tomorrow
    }

    try {
      const removed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(liveRef);
        const now = snap.exists ? (snap.data().log || {}) : {};
        const del = [];
        for (const d of days) {
          if (now[d] === undefined) continue;
          // Delete only what the archive provably holds as-is.
          if (sameDay(now[d], live[d]) && archivedLog[d] !== undefined) del.push(d);
          else result.skipped.push(d);
        }
        if (del.length) {
          const args = [];
          for (const d of del) args.push(new FieldPath('log', d), FieldValue.delete());
          tx.update(liveRef, ...args);
        }
        return del.length;
      });
      result.movedDays += removed;
      result.months.push(month);
    } catch (err) {
      result.errors.push(`${month} live delete: ${err.message}`);
    }
  }
  return result;
}

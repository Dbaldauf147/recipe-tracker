// Scheduled daily backup of every user's main doc fields, captured by
// reflection. The Admin SDK lets us enumerate fields and subcollections
// without a hardcoded list, so any new field added by future features is
// snapshotted automatically — no per-feature wiring.
//
// Output: users/{uid}/backups/full-server-YYYY-MM-DD
//   {
//     data: { /* every field on the main user doc */ },
//     subcollections: ['data', 'mealImages', 'backups', ...],  // names only
//     date: 'YYYY-MM-DD',
//     timestamp: ISO,
//     version: 1,
//     source: 'scheduled-fn',
//   }
//
// Subcollection *contents* are not duplicated — they already survive
// main-doc deletion (Firestore allows orphaned subcollections, which is
// exactly what saved this user's recipes during the 2026-05-06 incident).
// We snapshot the LIST of subcollection names so we can detect when a new
// one appears and confirm none have disappeared.

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';

initializeApp();
const db = getFirestore();

const SOFT_DELETE_GRACE_DAYS = 30;

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

async function backupOneUser(uid) {
  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  const data = snap.exists ? snap.data() : null;

  // Enumerate subcollections — this is the part the client SDK can't do.
  // listCollections() asks Firestore "what's actually there?" so any new
  // subcollection added by future features shows up here without us
  // updating the function.
  const subs = await userRef.listCollections();
  const subcollections = subs.map(c => c.id);

  const today = todayUTC();
  await db.doc(`users/${uid}/backups/full-server-${today}`).set({
    data: data || {},
    docExists: !!snap.exists,
    subcollections,
    date: today,
    timestamp: FieldValue.serverTimestamp(),
    version: 1,
    source: 'scheduled-fn',
  });
}

/**
 * Daily 03:30 UTC. Runs over every user doc and creates a server-side
 * snapshot. Independent of the client — fires whether or not the user
 * has opened the app that day.
 */
export const dailyUserBackup = onSchedule(
  {
    schedule: '30 3 * * *',
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const usersSnap = await db.collection('users').get();
    logger.info(`Backing up ${usersSnap.size} user(s)`);
    let success = 0;
    let failed = 0;
    for (const u of usersSnap.docs) {
      try {
        await backupOneUser(u.id);
        success++;
      } catch (err) {
        failed++;
        logger.error(`Backup failed for ${u.id}:`, err);
      }
    }
    logger.info(`Done: ${success} succeeded, ${failed} failed`);
  },
);

/**
 * Recursively delete all documents under a collection. Used during the real
 * (post-grace-window) deletion to clean up subcollection contents that
 * deleteDoc on the parent doesn't touch.
 */
async function deleteCollectionRecursive(colRef) {
  const docs = await colRef.listDocuments();
  for (const docRef of docs) {
    // Recurse into any nested subcollections first
    const nestedCols = await docRef.listCollections();
    for (const nestedCol of nestedCols) {
      await deleteCollectionRecursive(nestedCol);
    }
    await docRef.delete();
  }
}

/**
 * Permanent deletion path for users whose deletedAt has aged past the
 * grace window. Removes:
 *   - All subcollections under users/{uid}/* (recipes, dailyLog, workoutLog,
 *     mealImages, backups, data, anything else added by future features)
 *   - The main user doc
 *   - The Firebase Auth user record
 *
 * Runs every day. Idempotent — re-running is safe.
 *
 * Note: deletedAt is a Firestore server-timestamp Timestamp, not a string.
 * We compare using Firestore's where(<) against a JS Date and Firestore
 * will coerce.
 */
export const processSoftDeletes = onSchedule(
  {
    schedule: '0 4 * * *', // 30 minutes after the daily backup
    timeZone: 'Etc/UTC',
    region: 'us-central1',
    timeoutSeconds: 540,
    memory: '512MiB',
  },
  async () => {
    const cutoff = new Date(Date.now() - SOFT_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    const expired = await db
      .collection('users')
      .where('deletedAt', '<=', cutoff)
      .get();

    if (expired.empty) {
      logger.info('No accounts past the soft-delete grace window.');
      return;
    }

    logger.info(`Processing ${expired.size} expired soft-delete(s)`);
    let purged = 0;
    let failed = 0;

    for (const userDoc of expired.docs) {
      const uid = userDoc.id;
      try {
        // 1. Delete all subcollections recursively
        const subs = await userDoc.ref.listCollections();
        for (const subCol of subs) {
          await deleteCollectionRecursive(subCol);
        }
        // 2. Delete the main user doc
        await userDoc.ref.delete();
        // 3. Delete the Firebase Auth account (if it still exists). Wrapped
        //    in its own try so a missing auth record doesn't fail the run.
        try {
          await getAuth().deleteUser(uid);
        } catch (authErr) {
          if (authErr?.code !== 'auth/user-not-found') {
            logger.warn(`Auth deletion failed for ${uid}:`, authErr);
          }
        }
        logger.info(`Permanently deleted account ${uid}`);
        purged++;
      } catch (err) {
        failed++;
        logger.error(`Soft-delete cleanup failed for ${uid}:`, err);
      }
    }

    logger.info(`Soft-delete sweep done: ${purged} purged, ${failed} failed`);
  },
);

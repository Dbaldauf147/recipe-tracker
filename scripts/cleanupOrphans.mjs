#!/usr/bin/env node
/**
 * Find and (optionally) clean up orphaned Firestore user data — i.e. user
 * paths under users/{uid} where no matching Firebase Auth record exists.
 *
 * Background: when deleteAccount() runs, the Firebase Auth user and the
 * main users/{uid} doc are deleted, but subcollections (recipes, dailyLog,
 * workoutLog, mealImages, backups, data) survive. Repeated over time this
 * leaves dead subcollections taking up storage and complicating audits.
 *
 * This script:
 *   1. Lists every user-doc path it can find — both top-level docs and
 *      paths inferred from existing subcollections (so it catches "ghost"
 *      paths where the doc was deleted but subcollections remain).
 *   2. Looks up each UID in Firebase Auth.
 *   3. Reports orphans (no Auth record).
 *   4. With --confirm, recursively deletes all subcollections + main doc
 *      for each orphaned UID.
 *
 * SAFETY:
 *   - --dryRun is the DEFAULT. The script never deletes unless you pass
 *     --confirm explicitly.
 *   - --confirm without --dryRun is the only way to delete.
 *   - --skip=<uid>,<uid> lets you protect specific UIDs from cleanup.
 *
 * Usage:
 *   # See what would be deleted (safe — no writes)
 *   node scripts/cleanupOrphans.mjs --key=service-account.json
 *
 *   # Skip specific UIDs (e.g. test accounts you want to keep around)
 *   node scripts/cleanupOrphans.mjs --key=service-account.json --skip=2To0MKr...,abc123
 *
 *   # Actually perform the deletes
 *   node scripts/cleanupOrphans.mjs --key=service-account.json --confirm
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { dryRun: true, skip: new Set() };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--key=')) args.key = a.slice('--key='.length);
    else if (a === '--confirm') args.dryRun = false;
    else if (a === '--dryRun' || a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--skip=')) {
      a.slice('--skip='.length).split(',').forEach(uid => args.skip.add(uid.trim()));
    }
  }
  return args;
}

async function deleteCollectionRecursive(db, colRef) {
  const docs = await colRef.listDocuments();
  let deleted = 0;
  for (const docRef of docs) {
    const nested = await docRef.listCollections();
    for (const n of nested) deleted += await deleteCollectionRecursive(db, n);
    await docRef.delete();
    deleted++;
  }
  return deleted;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.key) {
    console.error('Usage: node scripts/cleanupOrphans.mjs --key=<service-account.json> [--confirm] [--skip=uid1,uid2]');
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(args.key, 'utf8'));
  initializeApp({ credential: cert(credentials) });
  const db = getFirestore();
  const auth = getAuth();

  console.log(`Mode: ${args.dryRun ? 'DRY RUN (no deletes)' : 'LIVE (will delete)'}`);
  if (args.skip.size > 0) console.log(`Skipping UIDs: ${[...args.skip].join(', ')}`);
  console.log('');

  // Step 1: collect all UIDs that have ANY Firestore footprint — either
  // a main user doc or a non-empty subcollection.
  const seen = new Set();

  const usersCol = db.collection('users');
  const allDocs = await usersCol.listDocuments();
  for (const ref of allDocs) {
    seen.add(ref.id);
  }
  console.log(`Found ${seen.size} user-doc paths under users/`);

  // Step 2: for each, check Firebase Auth.
  const orphans = [];
  let checked = 0;
  for (const uid of seen) {
    checked++;
    if (args.skip.has(uid)) continue;
    try {
      await auth.getUser(uid);
      // exists — not an orphan
    } catch (err) {
      if (err?.code === 'auth/user-not-found') {
        orphans.push(uid);
      } else {
        console.warn(`Auth lookup failed for ${uid}:`, err.message);
      }
    }
    if (checked % 25 === 0) console.log(`  Checked ${checked}/${seen.size}...`);
  }

  console.log('');
  console.log(`Orphaned UIDs (no Auth record): ${orphans.length}`);
  if (orphans.length === 0) {
    console.log('Nothing to clean up.');
    return;
  }

  // Step 3: per-orphan footprint report.
  for (const uid of orphans) {
    const ref = db.doc(`users/${uid}`);
    const docSnap = await ref.get();
    const subs = await ref.listCollections();
    const subSummaries = [];
    for (const s of subs) {
      const docs = await s.listDocuments();
      subSummaries.push(`${s.id}(${docs.length})`);
    }
    console.log(`  ${uid}: doc=${docSnap.exists ? 'exists' : 'missing'} subs=[${subSummaries.join(', ') || '(none)'}]`);
  }

  if (args.dryRun) {
    console.log('');
    console.log('✓ Dry run — no data was deleted.');
    console.log('  Re-run with --confirm to delete the orphans listed above.');
    return;
  }

  // Step 4: actually delete.
  console.log('');
  console.log('Deleting orphans...');
  let purged = 0;
  let failed = 0;
  for (const uid of orphans) {
    const ref = db.doc(`users/${uid}`);
    try {
      const subs = await ref.listCollections();
      let docCount = 0;
      for (const s of subs) {
        docCount += await deleteCollectionRecursive(db, s);
      }
      const docSnap = await ref.get();
      if (docSnap.exists) await ref.delete();
      console.log(`  Deleted ${uid} (${docCount} subcollection doc(s))`);
      purged++;
    } catch (err) {
      console.error(`  Failed to delete ${uid}:`, err.message);
      failed++;
    }
  }
  console.log('');
  console.log(`✓ Purged ${purged}, failed ${failed}`);
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});

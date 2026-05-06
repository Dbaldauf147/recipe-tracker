#!/usr/bin/env node
/**
 * Migrate a user's data from one UID to another. Copies the `data` subcollection
 * (recipes, dailyLog, workoutLog, workoutDraft) plus `mealImages` and `backups`
 * subcollections.
 *
 * Why this exists: Firebase Auth doesn't unify accounts across sign-in methods.
 * If a user's original auth record is lost / replaced (e.g. they re-sign in with
 * Google after their old account was deleted), the recipes still live under the
 * old UID's subcollections — we just need to copy them to the new UID.
 *
 * Safety: writes use { merge: true } where possible. The destination UID's
 * `bodyStats`, `nutritionGoals`, `weightLog`, etc. on the main user doc are NOT
 * touched (we don't want to overwrite freshly-entered onboarding data).
 *
 * Usage:
 *   # Dry run first (always do this)
 *   node scripts/migrateUserData.mjs --from=<oldUid> --to=<newUid> --key=<service-account.json> --dryRun
 *
 *   # Then actually run it
 *   node scripts/migrateUserData.mjs --from=<oldUid> --to=<newUid> --key=<service-account.json>
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = {};
  for (const a of argv.slice(2)) {
    if (a.startsWith('--from=')) args.from = a.slice('--from='.length);
    else if (a.startsWith('--to=')) args.to = a.slice('--to='.length);
    else if (a.startsWith('--key=')) args.key = a.slice('--key='.length);
    else if (a === '--dryRun' || a === '--dry-run') args.dryRun = true;
  }
  return args;
}

async function copyDoc(db, fromPath, toPath, dryRun) {
  const snap = await db.doc(fromPath).get();
  if (!snap.exists) {
    console.log(`  [SKIP] ${fromPath} — does not exist`);
    return false;
  }
  const data = snap.data();
  const size = JSON.stringify(data).length;
  console.log(`  [${dryRun ? 'DRY' : 'COPY'}] ${fromPath} → ${toPath} (${size.toLocaleString()} bytes)`);
  if (!dryRun) {
    await db.doc(toPath).set(data, { merge: true });
  }
  return true;
}

async function copySubcollection(db, fromPath, toPath, dryRun) {
  const fromCol = db.collection(fromPath);
  const toCol = db.collection(toPath);
  const snaps = await fromCol.get();
  if (snaps.empty) {
    console.log(`  [SKIP] ${fromPath} — empty subcollection`);
    return 0;
  }
  let count = 0;
  for (const doc of snaps.docs) {
    const data = doc.data();
    const size = JSON.stringify(data).length;
    console.log(`  [${dryRun ? 'DRY' : 'COPY'}] ${fromPath}/${doc.id} → ${toPath}/${doc.id} (${size.toLocaleString()} bytes)`);
    if (!dryRun) {
      await toCol.doc(doc.id).set(data, { merge: true });
    }
    count++;
  }
  return count;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.from || !args.to || !args.key) {
    console.error('Usage: node scripts/migrateUserData.mjs --from=<oldUid> --to=<newUid> --key=<service-account.json> [--dryRun]');
    process.exit(1);
  }
  if (args.from === args.to) {
    console.error('--from and --to are the same; nothing to do');
    process.exit(1);
  }

  const credentials = JSON.parse(readFileSync(args.key, 'utf8'));
  initializeApp({ credential: cert(credentials) });
  const db = getFirestore();

  console.log(`Migrating user data:`);
  console.log(`  FROM: users/${args.from}`);
  console.log(`  TO:   users/${args.to}`);
  console.log(`  Mode: ${args.dryRun ? 'DRY RUN (no writes)' : 'LIVE (will write)'}`);
  console.log('');

  // 1. data/* docs (recipes, dailyLog, workoutLog, workoutDraft)
  console.log('=== data/ subcollection ===');
  const dataDocs = ['recipes', 'dailyLog', 'workoutLog', 'workoutDraft'];
  for (const id of dataDocs) {
    await copyDoc(db, `users/${args.from}/data/${id}`, `users/${args.to}/data/${id}`, args.dryRun);
  }

  // 2. mealImages subcollection (one doc per meal image)
  console.log('\n=== mealImages subcollection ===');
  const imgCount = await copySubcollection(
    db,
    `users/${args.from}/mealImages`,
    `users/${args.to}/mealImages`,
    args.dryRun,
  );
  console.log(`  Total: ${imgCount} mealImage doc(s)`);

  // 3. backups subcollection (recipe snapshots, etc.)
  console.log('\n=== backups subcollection ===');
  const bkCount = await copySubcollection(
    db,
    `users/${args.from}/backups`,
    `users/${args.to}/backups`,
    args.dryRun,
  );
  console.log(`  Total: ${bkCount} backup doc(s)`);

  console.log('');
  console.log(args.dryRun ? '✓ Dry run complete — no data changed.' : '✓ Migration complete.');
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

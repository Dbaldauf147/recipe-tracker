#!/usr/bin/env node
/**
 * Move `restaurants` off the user document into users/{uid}/data/eatingOut.
 *
 * The Eating Out list is a single ~150KB array that every spot edit rewrites
 * whole, sitting on the same document friends are allowed to read in full.
 * This copies it into its own doc, mirroring users/{uid}/data/recipes — where
 * a rule can gate it on `sharedEatingOutWith` instead.
 *
 * Two phases, deliberately separate:
 *   --copy    write users/{uid}/data/eatingOut from the user-doc field.
 *             Idempotent, non-destructive, safe to run before the clients ship.
 *   --cleanup delete the user-doc field, ONCE the clients read the new doc.
 *             Refuses to touch a user whose subdoc count doesn't match.
 *
 * Usage:
 *   node scripts/migrateRestaurants.mjs --copy    --key=<serviceAccount.json> [--email=<one user>]
 *   node scripts/migrateRestaurants.mjs --cleanup --key=<serviceAccount.json> [--email=<one user>]
 *   ...add --dry to print what would happen and write nothing.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';

const args = {};
for (const a of process.argv.slice(2)) {
  const [k, ...rest] = a.replace(/^--/, '').split('=');
  args[k] = rest.length ? rest.join('=') : true;
}
if (!args.key || (!args.copy && !args.cleanup)) {
  console.error('Need --key=<serviceAccount.json> and one of --copy / --cleanup');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(args.key, 'utf8'))) });
const db = getFirestore();
const dry = !!args.dry;

const kb = (v) => (Buffer.byteLength(JSON.stringify(v ?? null), 'utf8') / 1024).toFixed(1);

async function targetUids() {
  if (args.email) return [(await getAuth().getUserByEmail(args.email)).uid];
  const snap = await db.collection('users').get();
  return snap.docs.map(d => d.id);
}

let copied = 0, skipped = 0, cleaned = 0, blocked = 0;

for (const uid of await targetUids()) {
  const userRef = db.doc(`users/${uid}`);
  const subRef = db.doc(`users/${uid}/data/eatingOut`);
  const [userSnap, subSnap] = await Promise.all([userRef.get(), subRef.get()]);
  const field = userSnap.exists ? userSnap.data().restaurants : undefined;
  const sub = subSnap.exists ? subSnap.data().restaurants : undefined;
  const fieldRows = Array.isArray(field) ? field : null;
  const subRows = Array.isArray(sub) ? sub : null;

  if (args.copy) {
    if (!fieldRows || fieldRows.length === 0) { skipped++; continue; }
    // Never let a copy shrink what's already in the subdoc — if the clients
    // have started writing there, they're ahead of the legacy field.
    if (subRows && subRows.length > fieldRows.length) {
      console.log(`SKIP  ${uid}: subdoc has ${subRows.length} rows, field only ${fieldRows.length}`);
      skipped++;
      continue;
    }
    console.log(`COPY  ${uid}: ${fieldRows.length} rows (${kb(fieldRows)} KB)${dry ? ' [dry]' : ''}`);
    if (!dry) await subRef.set({ restaurants: fieldRows, migratedAt: new Date().toISOString() });
    copied++;
  }

  if (args.cleanup) {
    if (!fieldRows || fieldRows.length === 0) { skipped++; continue; }
    if (!subRows || subRows.length < fieldRows.length) {
      console.log(`BLOCK ${uid}: subdoc has ${subRows ? subRows.length : 'nothing'}, field has ${fieldRows.length} — copy first`);
      blocked++;
      continue;
    }
    console.log(`CLEAN ${uid}: dropping ${fieldRows.length} rows (${kb(fieldRows)} KB) from the user doc${dry ? ' [dry]' : ''}`);
    if (!dry) await userRef.update({ restaurants: FieldValue.delete() });
    cleaned++;
  }
}

console.log(`\ncopied=${copied} cleaned=${cleaned} skipped=${skipped} blocked=${blocked}${dry ? ' (dry run)' : ''}`);

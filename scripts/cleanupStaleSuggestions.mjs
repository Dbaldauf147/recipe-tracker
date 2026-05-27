// One-off: remove leftover recipe entries on FUTURE dates (strictly after
// today in ET) that were placed by the old "Suggest meals" button before
// the cook-picker gated auto-fill on selection.
//
// By default removes: Veggie Omelette, Veggie Chilli.
// Pass --all to nuke every non-autoSuggested recipe entry on future dates
// (use when starting from a clean slate). Today is never touched.

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

function loadEnvLocal() {
  const text = readFileSync(resolve(PROJECT_ROOT, '.env.local'), 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1);
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

function easternDateKey(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shouldRemove(entry, mode) {
  if (entry.type !== 'recipe') return false;
  if (entry.autoSuggested) return false; // managed by new rebuild
  if (mode === 'all') return true;
  const n = String(entry.recipeName || '').toLowerCase();
  return n.includes('veggie omelette') || n.includes('veggie chilli') || n.includes('veggie chili');
}

async function main() {
  loadEnvLocal();
  const mode = process.argv.includes('--all') ? 'all' : 'named';
  const dryRun = process.argv.includes('--dry-run');

  if (getApps().length === 0) {
    const fallback = 'C:/Users/Dan Baldauf/Downloads/sunday-routine-firebase-adminsdk-fbsvc-a399556612.json';
    const sa = JSON.parse(readFileSync(fallback, 'utf8'));
    initializeApp({ credential: cert(sa) });
  }
  const db = getFirestore();
  const user = await getAuth().getUserByEmail('baldaufdan@gmail.com');
  const docRef = db.doc(`users/${user.uid}/data/dailyLog`);
  const snap = await docRef.get();
  if (!snap.exists) { console.log('No dailyLog doc — nothing to do.'); return; }
  const log = snap.data().log || {};

  // Snapshot before any changes for audit trail / undo.
  const backupPath = resolve(PROJECT_ROOT, `dailyLog.backup.${Date.now()}.json`);
  writeFileSync(backupPath, JSON.stringify(log, null, 2));
  console.log(`Backup written: ${backupPath}`);

  const today = easternDateKey();
  console.log(`Today (ET): ${today}  Mode: ${mode}${dryRun ? '  [DRY RUN]' : ''}\n`);

  let totalRemoved = 0;
  const newLog = {};
  for (const [k, v] of Object.entries(log)) {
    newLog[k] = v;
    if (k <= today) continue; // strict future only
    const entries = v.entries || [];
    const kept = entries.filter(e => !shouldRemove(e, mode));
    const removed = entries.filter(e => shouldRemove(e, mode));
    if (removed.length > 0) {
      console.log(`${k}: removing ${removed.length}`);
      for (const r of removed) console.log(`  - [${r.mealSlot}] ${r.recipeName}`);
      newLog[k] = { ...v, entries: kept };
      totalRemoved += removed.length;
    }
  }

  console.log(`\nTotal entries to remove: ${totalRemoved}`);
  if (dryRun) { console.log('Dry run — no write.'); return; }
  if (totalRemoved === 0) { console.log('Nothing to do.'); return; }

  await docRef.set({ log: newLog }, { merge: true });
  console.log('Firestore updated.');
}

main().catch(e => { console.error('FAILED:', e); process.exit(1); });

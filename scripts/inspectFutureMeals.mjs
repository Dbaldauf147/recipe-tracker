// Recon: print all entries on dates >= today in baldaufdan's dailyLog so we
// can see what was left over from the old Suggest button vs. what's manual.

import { readFileSync } from 'node:fs';
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

async function main() {
  loadEnvLocal();
  if (getApps().length === 0) {
    const fallback = 'C:/Users/Dan Baldauf/Downloads/sunday-routine-firebase-adminsdk-fbsvc-a399556612.json';
    const sa = JSON.parse(readFileSync(fallback, 'utf8'));
    initializeApp({ credential: cert(sa) });
  }
  const db = getFirestore();
  const user = await getAuth().getUserByEmail('baldaufdan@gmail.com');
  const snap = await db.doc(`users/${user.uid}/data/dailyLog`).get();
  const log = snap.exists ? (snap.data().log || {}) : {};

  const today = easternDateKey();
  const futureKeys = Object.keys(log).filter(k => k >= today).sort();
  console.log(`Today (ET): ${today}\nFuture dates with data: ${futureKeys.length}\n`);

  for (const k of futureKeys) {
    const day = log[k];
    const entries = day.entries || [];
    const cookRecipes = day.cookRecipes || [];
    console.log(`--- ${k} ---`);
    console.log(`  cookRecipes: ${JSON.stringify(cookRecipes)}`);
    console.log(`  ${entries.length} entries:`);
    for (const e of entries) {
      const name = e.recipeName || e.ingredientName || '(?)';
      const flags = [];
      if (e.autoSuggested) flags.push('AUTO');
      if (e.cookDate) flags.push(`cook=${e.cookDate}`);
      console.log(`    [${e.mealSlot || '?'}] ${name} (type=${e.type}, id=${e.id?.slice(0, 12)}…)${flags.length ? ' ' + flags.join(' ') : ''}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });

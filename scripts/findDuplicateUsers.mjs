// Read-only: finds user docs that share an email (duplicate/re-signup
// accounts), which can cause friend requests to be addressed to a stale uid.
//
// Auth — provide a Firebase service account one of these ways:
//   1) FIREBASE_SERVICE_ACCOUNT env var holding the JSON, or
//   2) path to a service-account .json file as the first CLI arg, or
//   3) GOOGLE_APPLICATION_CREDENTIALS pointing at the file (ADC).
//
// Usage:
//   node scripts/findDuplicateUsers.mjs                       # uses env / ADC
//   node scripts/findDuplicateUsers.mjs ./serviceAccount.json
//   node scripts/findDuplicateUsers.mjs ./serviceAccount.json baldaufdan@gmail.com
//
// It does NOT modify anything — review the output, then merge manually.

import fs from 'fs';
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const saPath = process.argv[2] && process.argv[2].endsWith('.json') ? process.argv[2] : null;
const emailFilter = process.argv.find((a, i) => i >= 2 && a.includes('@'))?.toLowerCase() || null;

let credential;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  credential = cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT));
} else if (saPath) {
  credential = cert(JSON.parse(fs.readFileSync(saPath, 'utf8')));
} else {
  credential = applicationDefault();
}
initializeApp({ credential });
const db = getFirestore();

const snap = await db.collection('users').get();
const byEmail = new Map();
for (const d of snap.docs) {
  const data = d.data() || {};
  const email = (data.email || '').toLowerCase().trim();
  if (!email) continue;
  if (emailFilter && email !== emailFilter) continue;
  if (!byEmail.has(email)) byEmail.set(email, []);
  byEmail.get(email).push({
    uid: d.id,
    username: data.username || '',
    lastLogin: data.lastLogin || '',
    loginCount: data.loginCount || 0,
  });
}

// Same preference order as searchByEmail: has-username, then most recent login.
const rank = (r) => [r.username ? 1 : 0, r.lastLogin];
let dupes = 0;
for (const [email, list] of byEmail) {
  if (list.length < 2) continue;
  dupes++;
  list.sort((a, b) => {
    const [au, al] = rank(a); const [bu, bl] = rank(b);
    if (au !== bu) return bu - au;
    return String(bl).localeCompare(String(al));
  });
  console.log(`\n${email} — ${list.length} docs`);
  list.forEach((r, i) => {
    console.log(`  ${i === 0 ? '➜ KEEP ' : '  stale'} uid=${r.uid}  @${r.username || '(none)'}  lastLogin=${r.lastLogin || '?'}  logins=${r.loginCount}`);
  });
}
console.log(dupes === 0 ? '\nNo duplicate-email user docs found.' : `\n${dupes} email(s) with duplicate user docs. "KEEP" = what searchByEmail now picks.`);
process.exit(0);

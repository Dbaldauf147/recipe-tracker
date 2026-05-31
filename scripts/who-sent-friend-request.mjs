// One-off: list pending friend requests for a given recipient UID and
// resolve each sender's user doc so we can see who they actually are.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { readFileSync } from 'fs';

const TO_INPUT = process.argv[2];
const CRED_FILE = process.argv[3] || '.env.vercel.tmp';
if (!TO_INPUT) {
  console.error('Usage: node scripts/who-sent-friend-request.mjs <recipient-uid|email> [credential-file]');
  console.error('  credential-file may be either:');
  console.error('   - a raw service-account JSON key (e.g. serviceAccount.json from the Firebase console), or');
  console.error('   - a dotenv file containing FIREBASE_SERVICE_ACCOUNT="..." (default: .env.vercel.tmp)');
  process.exit(1);
}

// Accept either a raw service-account JSON key file or a dotenv file that holds
// FIREBASE_SERVICE_ACCOUNT="...". The dotenv value is extracted by regex so the
// multi-line private key survives intact (sourcing it via bash mangles newlines).
function loadServiceAccount(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new Error(`Could not read credential file "${path}". Pass a service-account JSON key or a dotenv file as the 2nd argument.`);
  }
  const trimmed = text.trimStart();
  if (path.endsWith('.json') || trimmed.startsWith('{')) {
    return JSON.parse(text); // raw service-account JSON
  }
  const match = text.match(/^FIREBASE_SERVICE_ACCOUNT="((?:[^"\\]|\\.)*)"/m);
  if (!match || !match[1]) {
    throw new Error(`FIREBASE_SERVICE_ACCOUNT not found (or empty) in "${path}", and it isn't a raw JSON key file. Download a key from Firebase console → Project settings → Service accounts and pass its path.`);
  }
  const saJson = match[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  return JSON.parse(saJson);
}

if (!getApps().length) {
  initializeApp({ credential: cert(loadServiceAccount(CRED_FILE)) });
}
const db = getFirestore();
const auth = getAuth();

// Allow passing an email instead of a UID — resolve it to a UID up front.
let toUid = TO_INPUT;
if (TO_INPUT.includes('@')) {
  try {
    const u = await auth.getUserByEmail(TO_INPUT);
    toUid = u.uid;
    console.log(`Resolved ${TO_INPUT} → uid ${toUid}\n`);
  } catch (e) {
    console.error(`Could not resolve email "${TO_INPUT}" to a user:`, e.message);
    process.exit(1);
  }
}

const snap = await db
  .collection('friendRequests')
  .where('to', '==', toUid)
  .where('status', '==', 'pending')
  .get();

if (snap.empty) {
  console.log('No pending friend requests for', toUid);
  process.exit(0);
}

for (const doc of snap.docs) {
  const r = doc.data();
  console.log('---');
  console.log('requestId:    ', doc.id);
  console.log('from (uid):   ', r.from);
  console.log('fromUsername: ', r.fromUsername || '(empty)');
  console.log('message:      ', r.message || '(none)');
  console.log('createdAt:    ', r.createdAt?.toDate?.() || r.createdAt || '(unknown)');

  if (r.from) {
    try {
      const userDoc = await db.collection('users').doc(r.from).get();
      const u = userDoc.exists ? userDoc.data() : null;
      console.log('user doc:');
      console.log('  displayName: ', u?.displayName || '(none)');
      console.log('  username:    ', u?.username || '(none)');
      console.log('  email:       ', u?.email || '(none)');
    } catch (e) {
      console.log('  user doc lookup failed:', e.message);
    }
    try {
      const authUser = await auth.getUser(r.from);
      console.log('auth record:');
      console.log('  email:       ', authUser.email || '(none)');
      console.log('  displayName: ', authUser.displayName || '(none)');
      console.log('  provider:    ', authUser.providerData?.[0]?.providerId || '(none)');
    } catch (e) {
      console.log('  auth lookup failed:', e.message);
    }
  }
}

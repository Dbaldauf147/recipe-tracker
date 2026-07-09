// GET /api/backup-user-data — daily cron (declared in vercel.json).
//
// Independent safety net: snapshots every user's dailyLog + recipes to
// users/{uid}/backups/{type}_{YYYY-MM-DD}, keeping the newest KEEP per type.
// Runs server-side so it survives any client bug. Skips empty docs so a
// transient empty state never replaces a good backup. Auth: CRON_SECRET.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();
const KEEP = 30;

function dateKeyET(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function countDailyLogEntries(log) {
  if (!log || typeof log !== 'object') return 0;
  let n = 0;
  for (const d of Object.keys(log)) n += Array.isArray(log[d]?.entries) ? log[d].entries.length : 0;
  return n;
}

async function prune(uid, type) {
  const col = db.collection(`users/${uid}/backups`);
  const snap = await col.where('type', '==', type).get();
  const docs = snap.docs.sort((a, b) => (b.data().date || '').localeCompare(a.data().date || ''));
  for (let i = KEEP; i < docs.length; i++) await docs[i].ref.delete();
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const header = req.headers.authorization || '';
    if (header !== `Bearer ${secret}` && req.query?.secret !== secret) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const date = dateKeyET();
  const summary = { date, users: 0, dailyLogBackups: 0, recipesBackups: 0, errors: [] };

  try {
    const snap = await db.collection('users').get();
    for (const u of snap.docs) {
      const uid = u.id;
      summary.users++;
      try {
        const dl = await db.doc(`users/${uid}/data/dailyLog`).get();
        const log = dl.exists ? (dl.data().log || {}) : null;
        if (log && countDailyLogEntries(log) > 0) {
          await db.doc(`users/${uid}/backups/dailyLog_${date}`).set({
            type: 'dailyLog', date, count: countDailyLogEntries(log), data: log, savedAt: new Date().toISOString(),
          });
          summary.dailyLogBackups++;
          await prune(uid, 'dailyLog');
        }

        const rc = await db.doc(`users/${uid}/data/recipes`).get();
        const recipes = rc.exists ? (rc.data().recipes || []) : null;
        if (Array.isArray(recipes) && recipes.length > 0) {
          await db.doc(`users/${uid}/backups/recipes_${date}`).set({
            type: 'recipes', date, count: recipes.length, data: recipes, savedAt: new Date().toISOString(),
          });
          summary.recipesBackups++;
          await prune(uid, 'recipes');
        }
      } catch (err) {
        summary.errors.push({ uid, err: err.message });
      }
    }
    return res.status(200).json({ ok: true, ...summary });
  } catch (err) {
    console.error('backup-user-data fatal:', err);
    return res.status(500).json({ error: err.message, partial: summary });
  }
}

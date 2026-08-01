// GET /api/snapshot-admin-metrics — daily cron (declared in vercel.json).
//
// Records one row per user into adminSnapshots/{YYYY-MM-DD} so the admin table
// can be read back over time.
//
// Why this snapshots when the Week Plan's goal history doesn't: those numbers
// are derived from dated log entries, so any past week can be recomputed. These
// aren't. `loginCount` is a running counter with no history, `recipes.length`
// is current state, and a push token is either there or it isn't — nothing in
// today's data says what any of them were last month. If it isn't captured as
// it happens, it's gone.
//
// Stores RAW figures only, never the derived engagement label: the dashboard
// applies its own thresholds at read time, so there's one definition of
// "Active" and re-tuning it re-reads the whole history rather than leaving old
// rows labelled by the old rule.
//
// Auth: CRON_SECRET.

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
// ~13 months, so a year-over-year comparison always has something to compare to.
const KEEP_DAYS = 400;

function dateKeyET(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Mirrors hasAppInstalled in AdminDashboard.jsx. `expoPushTokens` is written
// only by the native app, on notification permission — the one field the
// website can never produce, which is what makes it the install signal.
function hasPushToken(d) {
  return Array.isArray(d.expoPushTokens) && d.expoPushTokens.length > 0;
}

/**
 * Recipes moved to users/{uid}/data/recipes, leaving the main doc's `recipes`
 * field empty for every migrated user — reading only the user doc here would
 * have recorded 0 recipes for everyone, forever. loadAllUsers does the same
 * backfill for the live table.
 */
async function recipeCountFor(uid, d) {
  try {
    const sub = await db.doc(`users/${uid}/data/recipes`).get();
    const list = sub.exists ? (sub.data().recipes || []) : null;
    if (Array.isArray(list) && list.length > 0) return list.length;
  } catch { /* fall through to any legacy inline array */ }
  return Array.isArray(d.recipes) ? d.recipes.length : 0;
}

/** One compact row per user. Field names match what the dashboard reads. */
export async function buildUserRow(uid, d) {
  return {
    uid,
    email: d.email || '',
    displayName: d.displayName || '',
    recipeCount: await recipeCountFor(uid, d),
    loginCount: d.loginCount || 0,
    lastLogin: d.lastLogin || '',
    mobileLoginCount: d.mobileLoginCount || 0,
    mobileLastLogin: d.mobileLastLogin || '',
    appInstalled: hasPushToken(d),
  };
}

async function prune() {
  const col = db.collection('adminSnapshots');
  const snap = await col.get();
  const ids = snap.docs.map(x => x.id).sort(); // YYYY-MM-DD sorts chronologically
  for (let i = 0; i < ids.length - KEEP_DAYS; i++) {
    await col.doc(ids[i]).delete();
  }
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
  try {
    const snap = await db.collection('users').get();
    const users = await Promise.all(snap.docs.map(u => buildUserRow(u.id, u.data() || {})));

    // Totals are stored alongside the rows rather than summed on read: cheap,
    // and it means a chart of the headline numbers doesn't have to pull every
    // row of every day.
    const totals = {
      users: users.length,
      appInstalls: users.filter(u => u.appInstalled).length,
      recipes: users.reduce((n, u) => n + u.recipeCount, 0),
      webLogins: users.reduce((n, u) => n + u.loginCount, 0),
      appLogins: users.reduce((n, u) => n + u.mobileLoginCount, 0),
    };

    if (req.query?.dryRun) {
      return res.status(200).json({ dryRun: true, date, totals, users: users.length });
    }

    await db.doc(`adminSnapshots/${date}`).set({
      date, takenAt: new Date().toISOString(), source: 'cron', totals, users,
    });
    await prune();
    return res.status(200).json({ ok: true, date, totals, users: users.length });
  } catch (err) {
    console.error('[snapshot-admin-metrics] failed', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

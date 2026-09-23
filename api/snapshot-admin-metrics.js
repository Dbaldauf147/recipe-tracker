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
import { activeUsersIn } from '../lib/adminGrowth.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();
// How long the heavy per-user rows are kept. Past this a day is COMPACTED, not
// deleted: `users[]` goes, the headline `totals` stay, so the growth chart
// keeps its whole span while the drill-down stays bounded. ~13 months, so a
// year-over-year comparison still has per-user detail on both sides.
const DETAIL_DAYS = 400;

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

/**
 * Age out the per-user detail without losing the day.
 *
 * This used to delete the whole document, which quietly capped the growth
 * chart at 400 days — and unlike everything else in this app, a deleted
 * snapshot cannot be rebuilt from anything (see the header). So instead the
 * `users[]` array is dropped and the row is left behind: `date`, `takenAt` and
 * `totals` are ~150 bytes, against a few KB for the rows, and they are all the
 * chart ever reads.
 *
 * `totals.activeUsers` is computed BEFORE the rows go, because afterwards
 * nothing can recover it — that is the one figure the chart derives from
 * `users[]` rather than reading off `totals`.
 */
async function compactOldDetail() {
  const col = db.collection('adminSnapshots');
  const snap = await col.get();
  const docs = snap.docs
    .filter(d => Array.isArray(d.data()?.users))
    .sort((a, b) => a.id.localeCompare(b.id)); // YYYY-MM-DD sorts chronologically

  let compacted = 0;
  for (let i = 0; i < docs.length - DETAIL_DAYS; i++) {
    const data = docs[i].data() || {};
    const totals = { ...(data.totals || {}) };
    // Only when it actually computed. Writing null would be worse than leaving
    // it out: the reader treats a stored number as authoritative, and
    // Number(null) is 0, so a null here would read back as "nobody was active".
    const active = activeUsersIn(data);
    if (Number.isFinite(active)) totals.activeUsers = active;

    await docs[i].ref.set({
      date: data.date || docs[i].id,
      takenAt: data.takenAt || `${data.date || docs[i].id}T23:59:59Z`,
      source: data.source || 'cron',
      compactedAt: new Date().toISOString(),
      totals,
    });
    compacted += 1;
  }
  return compacted;
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
  const takenAt = new Date().toISOString();
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
    // Stored, not derived on read, so the figure outlives the rows it came
    // from once compactOldDetail() drops them.
    const active = activeUsersIn({ users, takenAt, date });
    if (Number.isFinite(active)) totals.activeUsers = active;

    if (req.query?.dryRun) {
      return res.status(200).json({ dryRun: true, date, totals, users: users.length });
    }

    await db.doc(`adminSnapshots/${date}`).set({
      date, takenAt, source: 'cron', totals, users,
    });
    const compacted = await compactOldDetail();
    return res.status(200).json({ ok: true, date, totals, users: users.length, compacted });
  } catch (err) {
    console.error('[snapshot-admin-metrics] failed', err);
    return res.status(500).json({ error: String(err?.message || err) });
  }
}

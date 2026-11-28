// GET /api/sync-rally-pto — hourly cron (declared in vercel.json crons).
//
// Feeds the Rally PTO page into Prep Day's habit PTO mode. Rally runs on its
// own Firebase project, so this pulls its /api/pto-export (shared secret, the
// same RALLY_EXPORT_KEY the other Rally bridges use) and writes the ranges to
// the owner's user doc as `habitPtoRally`. Both Habits pages and the phone read
// that field beside `habitPto` (see effectivePtoRanges), so a Rally PTO day
// stamps habits Skip and fires the PTO-day habit reminders like one booked here.
//
// A separate field rather than rows inside `habitPto` on purpose: the apps
// write `habitPto` whole, so a phone with a stale copy would wipe what the sync
// added, and a Remove there would just be re-added an hour later.
//
// Only ranges ending in the last LOOKBACK_DAYS or later are kept. PTO mode
// backfills empty cells on past days, and handing it a year of history would
// stamp Skip across months that predate this feed.
//
// Writes only on a change. A failed or unconfigured Rally read leaves the
// field alone — it never wipes what's there because Rally was unreachable.
//
// Auth: Vercel cron sends `Authorization: Bearer <CRON_SECRET>`; manual runs
// pass ?secret=. ?dryRun=1 reports without writing.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { OWNER_EMAIL } from '../src/utils/pageAccess.js';
import { normalizePtoRanges, samePtoRanges } from '../src/utils/habitPto.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const LOOKBACK_DAYS = 30;

function easternDayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const ok = (req.headers?.authorization || '') === `Bearer ${secret}` || req.query?.secret === secret;
    if (!ok) return res.status(401).json({ error: 'Unauthorized' });
  }
  const dryRun = req.query?.dryRun === '1' || req.query?.dryRun === 'true';

  const key = (process.env.RALLY_EXPORT_KEY || '').trim();
  if (!key) return res.status(200).json({ skipped: true, reason: 'No RALLY_EXPORT_KEY configured' });
  const base = process.env.RALLY_BASE_URL || 'https://rally-seven-theta.vercel.app';
  const from = easternDayKey(new Date(Date.now() - LOOKBACK_DAYS * 86400000));

  let ranges;
  try {
    const params = new URLSearchParams({ key, from });
    const r = await fetch(`${base}/api/pto-export?${params}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false || data.skipped || !Array.isArray(data.ranges)) {
      return res.status(200).json({ skipped: true, reason: data.reason || data.error || `Rally HTTP ${r.status}` });
    }
    ranges = normalizePtoRanges(data.ranges).filter(x => x.end >= from);
  } catch (err) {
    return res.status(200).json({ skipped: true, reason: `Rally unreachable: ${err.message}` });
  }

  try {
    const uid = (await getAuth().getUserByEmail(OWNER_EMAIL)).uid;
    const ref = getFirestore().collection('users').doc(uid);
    const snap = await ref.get();
    const current = snap.exists ? snap.data().habitPtoRally : undefined;
    const changed = !Array.isArray(current) || !samePtoRanges(current, ranges);
    if (changed && !dryRun) await ref.set({ habitPtoRally: ranges }, { merge: true });
    return res.status(200).json({ ok: true, from, ranges: ranges.length, changed, dryRun, ...(dryRun ? { preview: ranges } : {}) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

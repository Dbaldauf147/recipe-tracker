// The feed between Prep Day's Eating Out list and Wealth Architect (the
// owner's finance tracker), which runs on a separate Firebase project. Neither
// app holds the other's database credentials; this route is the whole contract.
//
// GET  /api/wealth-sync — the owner's spots (just what's needed to match a card
//   charge to one) and the visits already logged, so the other side can show
//   what's been sent.
// POST /api/wealth-sync — { ops: [{ op: 'add', externalId, placeId, date,
//   amount, merchant } | { op: 'remove', externalId }] }. Logs (or takes back)
//   visits; see src/utils/spotVisits.js for what a visit does to a spot.
//
// Auth: header `x-wealth-sync-secret`, compared with WEALTH_SYNC_SECRET. It's a
// server-to-server secret — Wealth Architect's own API route adds it, so it is
// never in either app's browser bundle.
//
// Env:
//   WEALTH_SYNC_SECRET   shared secret, must match Wealth Architect's PREPDAY_SYNC_SECRET
//   WEALTH_SYNC_UID      optional; whose list this is. Defaults to the owner
//                        (OWNER_EMAIL), the only account this is meant for.

import { timingSafeEqual } from 'node:crypto';
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { OWNER_EMAIL } from '../src/utils/pageAccess.js';
import { applyVisitOps } from '../src/utils/spotVisits.js';

if (getApps().length === 0) {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
    : null;
  if (serviceAccount) initializeApp({ credential: cert(serviceAccount) });
  else initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || 'sunday-routine' });
}

const db = getFirestore();
const MAX_OPS = 200;

function secretMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ownerUid() {
  if (process.env.WEALTH_SYNC_UID) return process.env.WEALTH_SYNC_UID;
  return (await getAuth().getUserByEmail(OWNER_EMAIL)).uid;
}

// What the other side needs to pick a spot — not ratings, notes or photos.
function slim(r) {
  return {
    id: r.id,
    name: r.name || '',
    address: r.address || '',
    cuisines: Array.isArray(r.cuisines) ? r.cuisines : [],
    locations: Array.isArray(r.locations) ? r.locations : [],
    status: r.status || '',
    lastVisit: r.lastVisit || null,
  };
}

export default async function handler(req, res) {
  const secret = process.env.WEALTH_SYNC_SECRET;
  if (!secret) {
    return res.status(503).json({ error: 'The Wealth Architect feed is not switched on. Set WEALTH_SYNC_SECRET.' });
  }
  if (!secretMatches(req.headers['x-wealth-sync-secret'], secret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let uid;
  try {
    uid = await ownerUid();
  } catch (err) {
    console.error('wealth-sync owner lookup:', err);
    return res.status(500).json({ error: 'Could not find the owner account' });
  }
  const spotsRef = db.doc(`users/${uid}/data/eatingOut`);
  const visitsRef = db.doc(`users/${uid}/data/eatingOutVisits`);

  if (req.method === 'GET') {
    try {
      const [spotsSnap, visitsSnap] = await Promise.all([spotsRef.get(), visitsRef.get()]);
      const rows = spotsSnap.exists && Array.isArray(spotsSnap.data()?.restaurants) ? spotsSnap.data().restaurants : [];
      return res.status(200).json({
        places: rows.filter(r => r?.id && r?.name).map(slim),
        visits: (visitsSnap.exists && visitsSnap.data()?.visits) || {},
      });
    } catch (err) {
      console.error('wealth-sync read:', err);
      return res.status(500).json({ error: 'Could not read the Eating Out list' });
    }
  }

  const ops = Array.isArray(req.body?.ops) ? req.body.ops : null;
  if (!ops || !ops.length) return res.status(400).json({ error: 'ops must be a non-empty array' });
  if (ops.length > MAX_OPS) return res.status(400).json({ error: `At most ${MAX_OPS} ops per request` });

  try {
    // One transaction over both documents. The spot list is shared and edited
    // from the app at the same time, so it's re-read here and only the spots a
    // visit touches are replaced — the same rule saveSpotForOwner follows.
    const results = await db.runTransaction(async tx => {
      const [spotsSnap, visitsSnap] = await Promise.all([tx.get(spotsRef), tx.get(visitsRef)]);
      const restaurants = spotsSnap.exists && Array.isArray(spotsSnap.data()?.restaurants) ? spotsSnap.data().restaurants : [];
      const visits = (visitsSnap.exists && visitsSnap.data()?.visits) || {};
      const out = applyVisitOps({ visits, restaurants, ops });
      tx.set(visitsRef, { visits: out.visits, updatedAt: new Date().toISOString() });
      if (out.changed) tx.set(spotsRef, { restaurants: out.restaurants }, { merge: true });
      return out.results;
    });
    const failed = results.filter(r => !r.ok).length;
    return res.status(failed && failed === results.length ? 400 : 200).json({ results });
  } catch (err) {
    console.error('wealth-sync write:', err);
    return res.status(500).json({ error: 'Could not log the visits' });
  }
}

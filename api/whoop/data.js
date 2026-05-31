// GET /api/whoop/data?uid=<uid>&t=<firebaseIdToken>&days=14
//
// Returns normalized Whoop data for the last N days. Refreshes the access
// token when needed, and merges the per-day rollup into users/{uid}.whoopDaily
// so the calorie-budget feature works even when this page isn't open.

import { verifyCaller, getValidAccessToken, fetchWhoopData, db } from '../../lib/whoop.js';

export default async function handler(req, res) {
  try {
    const uid = await verifyCaller(req);
    const days = Math.min(60, Math.max(1, parseInt(req.query.days, 10) || 14));

    const accessToken = await getValidAccessToken(uid);
    if (!accessToken) {
      return res.status(200).json({ connected: false });
    }

    const data = await fetchWhoopData(accessToken, days);

    // Persist the per-day rollup (merge so older days are retained).
    try {
      const snap = await db.collection('users').doc(uid).get();
      const existing = (snap.exists && snap.data().whoopDaily) || {};
      const merged = { ...existing, ...data.daily };
      await db.collection('users').doc(uid).set({ whoopDaily: merged }, { merge: true });
    } catch (e) {
      console.error('whoopDaily merge failed:', e);
    }

    return res.status(200).json({ connected: true, ...data });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Failed to load Whoop data' });
  }
}

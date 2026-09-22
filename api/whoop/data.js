// GET /api/whoop/data?uid=<uid>&t=<firebaseIdToken>&days=14
//
// Returns normalized Whoop data for the last N days. Refreshes the access
// token when needed, and merges the per-day rollup into the history doc
// users/{uid}/data/whoopDaily (plus the trailing slice on the user doc) so the
// calorie-budget feature works even when this page isn't open.
//
// This endpoint is a ROLLING WINDOW and always has been — it cannot reach
// further back than `days`. Pulling the rest of the account's history is
// api/whoop/backfill.js.

import { verifyCaller, getValidAccessToken, fetchWhoopData, mergeWhoopDaily } from '../../lib/whoop.js';

// Matches the largest window any caller asks for. It used to be 60, which
// silently truncated the Progress page's days=90 request.
const MAX_DAYS = 90;

export default async function handler(req, res) {
  try {
    const uid = await verifyCaller(req);
    const days = Math.min(MAX_DAYS, Math.max(1, parseInt(req.query.days, 10) || 14));

    const accessToken = await getValidAccessToken(uid);
    if (!accessToken) {
      return res.status(200).json({ connected: false });
    }

    const data = await fetchWhoopData(accessToken, days);

    // Persist the per-day rollup (merge so older days are retained).
    try {
      await mergeWhoopDaily(uid, data.daily);
    } catch (e) {
      console.error('whoopDaily merge failed:', e);
    }

    return res.status(200).json({ connected: true, ...data });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Failed to load Whoop data' });
  }
}

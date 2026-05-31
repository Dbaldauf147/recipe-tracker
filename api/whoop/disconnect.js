// POST /api/whoop/disconnect?uid=<uid>&t=<firebaseIdToken>
//
// Revokes Whoop access (best effort) and removes the stored tokens, flipping
// the user back to disconnected.

import { verifyCaller, loadTokens, deleteTokens, WHOOP_API_BASE } from '../../lib/whoop.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const uid = await verifyCaller(req);
    const tok = await loadTokens(uid);
    if (tok?.accessToken) {
      // Best-effort revoke; ignore failures.
      try {
        await fetch(`${WHOOP_API_BASE}/v2/user/access`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tok.accessToken}` },
        });
      } catch { /* ignore */ }
    }
    await deleteTokens(uid);
    return res.status(200).json({ connected: false });
  } catch (err) {
    const status = err.status || 500;
    return res.status(status).json({ error: err.message || 'Failed to disconnect Whoop' });
  }
}

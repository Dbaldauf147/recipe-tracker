// GET /api/whoop/start?uid=<uid>&t=<firebaseIdToken>
//
// Begins the Whoop OAuth flow: verifies the caller, mints a short-lived state
// tied to their uid, and 302-redirects to Whoop's consent screen.

import { verifyCaller, createOAuthState, buildAuthorizeUrl } from '../../lib/whoop.js';

export default async function handler(req, res) {
  try {
    const uid = await verifyCaller(req);
    const state = await createOAuthState(uid);
    res.writeHead(302, { Location: buildAuthorizeUrl(state) });
    res.end();
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message || 'Failed to start Whoop auth' });
  }
}

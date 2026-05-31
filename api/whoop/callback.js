// GET /api/whoop/callback?code=<code>&state=<state>
//
// Whoop redirects here after the user consents. We resolve the state back to a
// uid, exchange the code for tokens, store them in the user's private
// subcollection, flag the user as connected, then bounce back into the SPA.

import { consumeOAuthState, exchangeCode, saveTokens, redirectUri } from '../../lib/whoop.js';

function appOrigin() {
  // Derive the SPA origin from the configured redirect URI so this works on
  // both preview and production deployments.
  try { return new URL(redirectUri()).origin; } catch { return 'https://prep-day.com'; }
}

export default async function handler(req, res) {
  const { code, state, error } = req.query;
  const origin = appOrigin();

  if (error) {
    res.writeHead(302, { Location: `${origin}/?whoop=error` });
    return res.end();
  }
  if (!code || !state) {
    res.writeHead(302, { Location: `${origin}/?whoop=error` });
    return res.end();
  }

  try {
    const uid = await consumeOAuthState(state);
    if (!uid) {
      res.writeHead(302, { Location: `${origin}/?whoop=error` });
      return res.end();
    }
    const tokens = await exchangeCode(code);
    await saveTokens(uid, tokens);
    res.writeHead(302, { Location: `${origin}/?whoop=connected` });
    res.end();
  } catch (err) {
    console.error('Whoop callback error:', err);
    res.writeHead(302, { Location: `${origin}/?whoop=error` });
    res.end();
  }
}

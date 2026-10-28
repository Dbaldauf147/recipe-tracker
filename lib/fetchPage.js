// Server-side fetch of a recipe page, shared by api/fetch-url and
// api/extract-recipe.
//
// We ask as a browser first — some sites only serve real HTML to one. But a
// Cloudflare-fronted site can tell a Chrome User-Agent from a non-browser TLS
// handshake and answers that mismatch with a 403 "Just a moment…" challenge
// (therealfooddietitians.com does exactly this), while the same request with
// an honest, non-browser User-Agent gets the full page, JSON-LD included. So
// on a block we ask once more as what we are.

export const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

export const PLAIN_HEADERS = {
  'User-Agent': 'PrepDayRecipeImporter/1.0 (+https://prep-day.com)',
  'Accept': 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** A bot wall rather than a missing page: worth asking again differently. */
export function isBlocked(response) {
  return response.status === 401 || response.status === 403 || response.status === 429
    || !!response.headers?.get?.('cf-mitigated');
}

/**
 * Fetch `url` → { html, status }. `html` is '' when every attempt failed;
 * `status` is the last HTTP status seen (0 = unreachable), for the error
 * message. Throws nothing.
 */
export async function fetchPageHtml(url, { fetchImpl = fetch } = {}) {
  let status = 0;
  for (const headers of [BROWSER_HEADERS, PLAIN_HEADERS]) {
    let response;
    try {
      response = await fetchImpl(url, { headers, redirect: 'follow' });
    } catch {
      continue; // network error: the second attempt may still get through
    }
    status = response.status;
    if (response.ok && !response.headers?.get?.('cf-mitigated')) {
      try {
        return { html: await response.text(), status };
      } catch {
        return { html: '', status };
      }
    }
    if (!isBlocked(response)) break; // a real 404 / 500 won't change with a new User-Agent
  }
  return { html: '', status };
}

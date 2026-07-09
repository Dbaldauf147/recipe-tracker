// GET /api/off-barcode?code=<barcode>
//
// Server-side proxy for OpenFoodFacts product lookups. The mobile Scan tab hits
// this instead of OFF directly so OFF sees a single IP (this function) and
// Vercel's edge cache absorbs repeat scans of the same barcode for 24h — which
// dodges OFF's tight anonymous per-IP rate limit (HTTP 429).
//
// Returns OFF's `{ status, product }` JSON verbatim on success (the mobile
// client checks `status === 1 && product`). On failure returns
// `{ error: <string>, status: 0 }` — `error` is ALWAYS a string so the client's
// `new Error(data.error)` shows a real message instead of "[object Object]".

const OFF_BASE = 'https://world.openfoodfacts.org/api/v0/product';

export default async function handler(req, res) {
  const code = (req.query?.code || '').toString().trim();
  if (!code || !/^[0-9]+$/.test(code)) {
    return res.status(400).json({ error: 'Missing or invalid barcode.', status: 0 });
  }

  try {
    const upstream = await fetch(`${OFF_BASE}/${encodeURIComponent(code)}.json`, {
      headers: {
        Accept: 'application/json',
        // OFF asks anonymous clients to identify themselves; sending a UA
        // reduces the chance of being throttled or blocked.
        'User-Agent': 'PrepDay/1.0 (https://prep-day.com)',
      },
    });

    const text = await upstream.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({
        error: `OpenFoodFacts returned a non-JSON response (HTTP ${upstream.status}).`,
        status: 0,
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status === 429 ? 429 : 502).json({
        error: upstream.status === 429
          ? 'rate-limited'
          : `OpenFoodFacts error (HTTP ${upstream.status}).`,
        status: 0,
      });
    }

    // Cache successful lookups at the edge for 24h (keyed by the per-barcode URL).
    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Lookup failed.', status: 0 });
  }
}

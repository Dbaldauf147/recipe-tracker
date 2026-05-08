// Vercel serverless function: geocode an address via OpenStreetMap Nominatim.
// Auto-routed at /api/geocode?q=<address>.
//
// Nominatim's terms ask for a stable User-Agent and a low request rate.
// Routing through here keeps client code clean and avoids any browser CORS
// quirks. Results are returned in a normalized shape:
//   { lat: number, lng: number, displayName: string }

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export default async function handler(req, res) {
  const q = (req.query?.q || req.body?.q || '').toString().trim();
  if (!q) {
    return res.status(400).json({ error: 'Missing q parameter' });
  }

  try {
    const url = `${NOMINATIM_URL}?format=json&limit=1&q=${encodeURIComponent(q)}`;
    const response = await fetch(url, {
      headers: {
        // Identify the requester per Nominatim's usage policy.
        'User-Agent': 'PrepDay/1.0 (https://prep-day.com; baldaufdan@gmail.com)',
        'Accept': 'application/json',
        'Accept-Language': 'en',
      },
    });
    if (!response.ok) {
      return res.status(502).json({ error: `Nominatim returned ${response.status}` });
    }
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ error: 'No results' });
    }
    const top = data[0];
    const lat = parseFloat(top.lat);
    const lng = parseFloat(top.lon);
    if (!isFinite(lat) || !isFinite(lng)) {
      return res.status(502).json({ error: 'Invalid coordinates from upstream' });
    }
    // Cache on the edge for an hour — same address shouldn't move.
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({
      lat,
      lng,
      displayName: top.display_name || q,
    });
  } catch (err) {
    return res.status(502).json({ error: err.message || 'Geocoder failed' });
  }
}

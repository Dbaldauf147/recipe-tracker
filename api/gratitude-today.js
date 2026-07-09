// Proxies today's gratitude count from the Gratitude app into Prep Day's Habits
// page (Automatic tab tile + the gratitude auto-log source). Like the Rally
// proxies, the shared secret (GRATITUDE_EXPORT_KEY) is attached server-side so it
// never reaches the browser. The caller passes its LOCAL day (?date=YYYY-MM-DD).
// Returns { loggedCount, goal, date } — loggedCount is null if unavailable.
const GRATITUDE_BASE_URL = process.env.GRATITUDE_BASE_URL || 'https://gratitude-website.vercel.app';

export default async function handler(req, res) {
  const date = (req.query?.date || '').toString().trim();

  const key = (process.env.GRATITUDE_EXPORT_KEY || '').trim();
  if (!key) {
    return res.status(200).json({ loggedCount: null, goal: 3, reason: 'No GRATITUDE_EXPORT_KEY configured' });
  }

  try {
    const params = new URLSearchParams({ key });
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) params.set('date', date);
    const r = await fetch(`${GRATITUDE_BASE_URL}/api/gratitude-today?${params}`);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(200).json({ loggedCount: null, goal: 3, reason: data.error || `Gratitude HTTP ${r.status}` });
    }
    return res.status(200).json({
      loggedCount: typeof data.loggedCount === 'number' ? data.loggedCount : null,
      goal: typeof data.goal === 'number' ? data.goal : 3,
      date: data.date || date,
    });
  } catch (err) {
    return res.status(200).json({ loggedCount: null, goal: 3, reason: err.message });
  }
}
